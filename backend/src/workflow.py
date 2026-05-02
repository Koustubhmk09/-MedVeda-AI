import json
from typing import TypedDict, Annotated, List, Union
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq
from src.prompt import classification_prompt, system_prompt, generation_template

class AgentState(TypedDict):
    messages: List[BaseMessage]
    query: str
    intent: str
    category: str
    risk_level: str
    db_context: str
    web_context: str
    final_answer: str
    confidence: str

def create_workflow(llm: ChatGroq, tools: list):
    medical_tool = tools[0]
    web_tool = tools[1]

    # --- NODES ---

    def classifier_node(state: AgentState):
        query = state["query"]
        messages = [
            ("system", classification_prompt)
        ] + state["messages"] + [
            ("human", query)
        ]
        response = llm.invoke(messages)
        try:
            clean_content = response.content.strip().replace("```json", "").replace("```", "")
            data = json.loads(clean_content)
        except:
            data = {"intent": "EXPLANATION", "category": "GENERAL", "risk_level": "LOW"}
        
        return {
            "intent": data.get("intent", "EXPLANATION"),
            "category": data.get("category", "GENERAL"),
            "risk_level": data.get("risk_level", "LOW")
        }

    def retriever_node(state: AgentState):
        if state["category"] == "GENERAL" and state["intent"] == "FACT":
            return {"db_context": "N/A"}
        
        query = state["query"]
        results = medical_tool.invoke(query)
        return {"db_context": str(results)}

    def web_search_node(state: AgentState):
        # Search web for facts or if it's general
        query = state["query"]
        results = web_tool.invoke(query)
        return {"web_context": str(results)}

    def generator_node(state: AgentState):
        prompt = generation_template.format(
            intent=state["intent"],
            category=state["category"],
            db_context=state["db_context"],
            web_context=state["web_context"],
            risk_level=state["risk_level"],
            query=state["query"]
        )
        
        messages = [
            ("system", system_prompt)
        ] + state["messages"] + [
            ("human", prompt)
        ]
        
        response = llm.invoke(messages)
        
        answer = response.content
        
        # Add dynamic disclaimer based on risk and category
        if state["category"] == "MEDICAL":
            if state["risk_level"] == "MEDIUM":
                disclaimer = "\n\n---\n*Note: This is informational guidance. Please consult a professional for medical concerns.*"
                if disclaimer not in answer:
                    answer += disclaimer
            elif state["risk_level"] == "HIGH":
                disclaimer = "\n\n---\n*Disclaimer: EMERGENCY SITUATION. I am an AI, not a doctor. Seek immediate medical attention. This information is for educational purposes only.*"
                if disclaimer not in answer:
                    answer += disclaimer
        
        return {"final_answer": answer}

    # --- GRAPH ---

    workflow = StateGraph(AgentState)

    workflow.add_node("classifier", classifier_node)
    workflow.add_node("retriever", retriever_node)
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("generator", generator_node)

    workflow.set_entry_point("classifier")
    
    workflow.add_edge("classifier", "retriever")
    workflow.add_edge("retriever", "web_search")
    workflow.add_edge("web_search", "generator")
    workflow.add_edge("generator", END)

    return workflow.compile()
