import os
from src.helper import download_hugging_face_embeddings, load_pdf_file, text_split
from langchain_pinecone import PineconeVectorStore
from dotenv import load_dotenv

load_dotenv()

PINECONE_API_KEY = os.environ.get('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.environ.get('PINECONE_INDEX_NAME')

def ingest_data():
    # 1. Load Data
    print("Loading PDF data...")
    extracted_data = load_pdf_file("data/")
    
    # 2. Split Data
    print("Splitting data into chunks...")
    text_chunks = text_split(extracted_data)
    
    # 3. Download Embeddings
    print("Downloading embeddings model...")
    embeddings = download_hugging_face_embeddings()
    
    # 4. Push to Pinecone
    print(f"Pushing {len(text_chunks)} chunks to Pinecone index: {PINECONE_INDEX_NAME}...")
    
    # Creating the Vector Store and pushing the data
    vectorstore = PineconeVectorStore.from_documents(
        documents=text_chunks,
        index_name=PINECONE_INDEX_NAME,
        embedding=embeddings,
        pinecone_api_key=PINECONE_API_KEY
    )
    
    print("Ingestion completed successfully!")

if __name__ == "__main__":
    if not PINECONE_API_KEY or not PINECONE_INDEX_NAME:
        print("Error: Please set PINECONE_API_KEY and PINECONE_INDEX_NAME in your .env file.")
    else:
        ingest_data()
