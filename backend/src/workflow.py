import json
from typing import TypedDict, Annotated, List, Union
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq
from .prompt import classification_prompt, system_prompt, generation_template, contextualize_q_system_prompt

class AgentState(TypedDict):
    messages: List[BaseMessage]
    query: str
    contextualized_query: str
    intent: str
    risk_level: str
    db_context: str
    web_context: str
    final_answer: str
    confidence: str

def create_workflow(llm: ChatGroq, tools: list):
    medical_tool = tools[0]
    web_tool = tools[1]

    # --- NODES ---

    def contextualize_node(state: AgentState):
        """Rewrites the user query to be standalone if there's history."""
        if not state["messages"]:
            return {"contextualized_query": state["query"]}
        
        messages = [
            ("system", contextualize_q_system_prompt)
        ] + state["messages"] + [
            ("human", state["query"])
        ]
        
        response = llm.invoke(messages)
        return {"contextualized_query": response.content.strip()}

    def classifier_node(state: AgentState):
        query = state["contextualized_query"]
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
            data = {"intent": "MEDICAL_CONCERN", "risk_level": "LOW"}
        
        return {
            "intent": data.get("intent", "MEDICAL_CONCERN"),
            "risk_level": data.get("risk_level", "LOW")
        }

    def retriever_node(state: AgentState):
        # Skip retrieval for greetings and simple facts
        if state["intent"] in ["GREETING", "FACT"]:
            return {"db_context": "N/A"}
        
        query = state["contextualized_query"]
        results = medical_tool.invoke(query)
        return {"db_context": str(results)}

    def web_search_node(state: AgentState):
        # Search web for medical or facts if DB context is thin
        if state["intent"] == "GREETING":
            return {"web_context": "N/A"}
            
        query = state["contextualized_query"]
        results = web_tool.invoke(query)
        return {"web_context": str(results)}

    def generator_node(state: AgentState):
        prompt = generation_template.format(
            intent=state["intent"],
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
        
        # Situational Disclaimer Logic: NO disclaimers for GREETING or FACT
        if state["intent"] in ["MEDICAL_CONCERN", "MEDICINE_REQUEST"]:
            if "disclaimer" not in answer.lower() and "consult" not in answer.lower():
                if state["risk_level"] == "HIGH":
                    answer += "\n\n**IMPORTANT: This situation may require urgent medical attention. Please seek professional help or visit an emergency room immediately.**"
                else:
                    answer += "\n\n*A quick note: This is for guidance only. Please consult a qualified doctor for a professional diagnosis.*"
        
        return {"final_answer": answer}

    # --- GRAPH ---

    workflow = StateGraph(AgentState)

    workflow.add_node("contextualize", contextualize_node)
    workflow.add_node("classifier", classifier_node)
    workflow.add_node("retriever", retriever_node)
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("generator", generator_node)

    workflow.set_entry_point("contextualize")
    
    workflow.add_edge("contextualize", "classifier")
    workflow.add_edge("classifier", "retriever")
    workflow.add_edge("retriever", "web_search")
    workflow.add_edge("web_search", "generator")
    workflow.add_edge("generator", END)

    return workflow.compile()
