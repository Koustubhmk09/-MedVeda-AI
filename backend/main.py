import os
import sys
import requests
import logging
import json
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from jose import JWTError, jwt
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from typing import Optional

from src.helper import download_hugging_face_embeddings
from src.prompt import system_prompt, title_generation_prompt
from src.workflow import create_workflow
from src.database import get_db, Base, engine
from src.models import User
from fastapi.security import OAuth2PasswordBearer

from langchain_pinecone import PineconeVectorStore
from langchain_groq import ChatGroq
from langchain_core.tools import create_retriever_tool, tool
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, AIMessage
from duckduckgo_search import DDGS

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="MedVeda AI")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PINECONE_API_KEY = os.environ.get('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.environ.get('PINECONE_INDEX_NAME')
GROQ_API_KEY = os.environ.get('GROQ_API_KEY')

# Global variable for the AI workflow
app_workflow = None
llm = None

# JSON Storage Setup
DATA_DIR = Path("data/chats")
DATA_DIR.mkdir(parents=True, exist_ok=True)

def get_chats_file(user_id):
    return DATA_DIR / f"chats_{user_id}.json"

def load_user_chats(user_id):
    file_path = get_chats_file(user_id)
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading chats for user {user_id}: {e}")
        return []

def save_user_chats(user_id, chats):
    file_path = get_chats_file(user_id)
    try:
        with open(file_path, "w") as f:
            json.dump(chats, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving chats for user {user_id}: {e}")

# Guest Chat Storage
GUEST_DIR = Path("data/chats/guests")
GUEST_DIR.mkdir(parents=True, exist_ok=True)

def get_guest_chat_file(chat_id):
    return GUEST_DIR / f"guest_{chat_id}.json"

def load_guest_chat(chat_id):
    file_path = get_guest_chat_file(chat_id)
    if not file_path.exists():
        return None
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading guest chat {chat_id}: {e}")
        return None

def save_guest_chat(chat_id, chat_data):
    file_path = get_guest_chat_file(chat_id)
    try:
        with open(file_path, "w") as f:
            json.dump(chat_data, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving guest chat {chat_id}: {e}")

@app.on_event("startup")
async def startup_event():
    global app_workflow
    try:
        if not PINECONE_API_KEY or not PINECONE_INDEX_NAME or not GROQ_API_KEY:
            logger.warning("Core API keys missing. AI features will not work until .env is configured.")
            return

        logger.info("Initializing MedVeda AI Core components...")
        
        # 1. Initialize Embeddings & Vector Store
        embeddings = download_hugging_face_embeddings()
        vectorstore = PineconeVectorStore.from_existing_index(
            index_name=PINECONE_INDEX_NAME,
            embedding=embeddings
        )
        retriever = vectorstore.as_retriever(search_kwargs={'k': 3})

        global llm
        llm = ChatGroq(
            model="llama-3.3-70b-versatile",
            temperature=0.7, 
            groq_api_key=GROQ_API_KEY
        )

        # 3. Define Tools
        medical_tool = create_retriever_tool(
            retriever,
            "medical_database_search",
            "Search for medical facts, symptoms, and treatments from the trusted medical encyclopedia."
        )
        
        @tool
        def web_search(query: str):
            """Search the web for real-time information."""
            try:
                with DDGS() as ddgs:
                    results = list(ddgs.text(query, max_results=5))
                    return "\n\n---\n\n".join([f"### {r.get('title')}\n{r.get('body')}" for r in results])
            except Exception as e:
                return f"Error: {str(e)}"
        
        global app_workflow
        tools = [medical_tool, web_search]
        app_workflow = create_workflow(llm, tools)

        # Create Database Tables (only User now)
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables verified.")
        logger.info("AI components initialized successfully")
    except Exception as e:
        logger.error(f"Startup error: {e}")

class ChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None

# JWT Config
SECRET_KEY = os.environ.get("SECRET_KEY", "medveda_ai_secret_key_123456789")
ALGORITHM = os.environ.get("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        user = db.query(User).filter(User.id == int(user_id)).first()
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

async def get_optional_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        if not token: return None
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        return db.query(User).filter(User.id == int(user_id)).first()
    except Exception:
        return None

# JSON Storage Endpoints
@app.get("/chats")
async def get_chats(current_user: User = Depends(get_current_user)):
    chats = load_user_chats(current_user.id)
    # Return brief info for sidebar
    return [{"id": c["id"], "title": c["title"], "created_at": c["created_at"]} for c in chats]

@app.get("/chats/{chat_id}")
async def get_chat(chat_id: str, current_user: User = Depends(get_current_user)):
    chats = load_user_chats(current_user.id)
    chat = next((c for c in chats if c["id"] == chat_id), None)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat

@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, current_user: User = Depends(get_current_user)):
    chats = load_user_chats(current_user.id)
    chats = [c for c in chats if c["id"] != chat_id]
    save_user_chats(current_user.id, chats)
    return {"message": "Deleted"}

@app.post("/chat")
async def chat(request: ChatRequest, current_user: Optional[User] = Depends(get_optional_user)):
    if app_workflow is None:
        raise HTTPException(status_code=503, detail="AI components not initialized")
    
    chat_id = request.chat_id
    chats = load_user_chats(current_user.id) if current_user else []
    
    # Load existing history
    history = []
    active_chat = None
    
    if current_user:
        active_chat = next((c for c in chats if c["id"] == chat_id), None)
    elif chat_id:
        active_chat = load_guest_chat(chat_id)
    
    if active_chat:
        # Pass last 10 messages for context to keep it snappy but aware
        for msg in active_chat.get("messages", [])[-10:]:
            if msg["role"] == "user":
                history.append(HumanMessage(content=msg["content"]))
            else:
                history.append(AIMessage(content=msg["content"]))
    
    # Process with Advanced LangGraph Workflow
    try:
        inputs = {"query": request.message, "messages": history}
        result = app_workflow.invoke(inputs)
        answer = result["final_answer"]
    except Exception as e:
        logger.error(f"AI error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Persistence logic
    chat_title = None
    new_chat_created = False
    
    if current_user:
        if not active_chat:
            chat_id = str(int(datetime.utcnow().timestamp()))
            new_chat_created = True
            
            # Generate intelligent title for new chats
            try:
                title_response = llm.invoke(title_generation_prompt.format(query=request.message))
                chat_title = title_response.content.strip().strip('"').strip("'")
            except Exception as e:
                logger.error(f"Title generation error: {e}")
                chat_title = request.message[:30] + "..."
                
            active_chat = {
                "id": chat_id,
                "title": chat_title,
                "created_at": datetime.utcnow().isoformat(),
                "messages": []
            }
            chats.append(active_chat)
        
        active_chat["messages"].append({"role": "user", "content": request.message, "created_at": datetime.utcnow().isoformat()})
        active_chat["messages"].append({"role": "assistant", "content": answer, "created_at": datetime.utcnow().isoformat()})
        
        save_user_chats(current_user.id, chats)
        return {"answer": answer, "chat_id": chat_id, "title": chat_title if new_chat_created else active_chat.get("title")}
    
    # For guest users
    if not chat_id:
        chat_id = "guest_" + str(int(datetime.utcnow().timestamp()))
        new_chat_created = True
        try:
            title_response = llm.invoke(title_generation_prompt.format(query=request.message))
            chat_title = title_response.content.strip().strip('"').strip("'")
        except Exception:
            chat_title = request.message[:30] + "..."
            
        active_chat = {
            "id": chat_id,
            "title": chat_title,
            "created_at": datetime.utcnow().isoformat(),
            "messages": []
        }
    
    active_chat["messages"].append({"role": "user", "content": request.message, "created_at": datetime.utcnow().isoformat()})
    active_chat["messages"].append({"role": "assistant", "content": answer, "created_at": datetime.utcnow().isoformat()})
    
    save_guest_chat(chat_id, active_chat)
    
    return {"answer": answer, "chat_id": chat_id, "title": chat_title if new_chat_created else active_chat.get("title")}

# Auth
class GoogleAuthRequest(BaseModel):
    token: str

@app.post("/auth/google")
async def google_auth(request: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        response = requests.get(f"https://www.googleapis.com/oauth2/v3/userinfo?access_token={request.token}")
        idinfo = response.json()
        email, full_name, google_id = idinfo["email"], idinfo.get("name", "User"), idinfo["sub"]

        user = db.query(User).filter(User.google_id == google_id).first()
        if not user:
            user = User(email=email, full_name=full_name, google_id=google_id)
            db.add(user)
            db.commit()
            db.refresh(user)
        
        access_token = jwt.encode({"sub": str(user.id), "email": user.email, "exp": datetime.utcnow() + timedelta(days=7)}, SECRET_KEY, algorithm=ALGORITHM)
        return {"access_token": access_token, "user": {"id": user.id, "email": user.email, "full_name": user.full_name}}
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.get("/health")
async def health():
    if app_workflow is not None:
        return {"status": "online", "message": "AI components initialized successfully"}
    return {"status": "initializing", "message": "AI components still loading or failed"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
