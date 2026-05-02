import os
from langchain_community.document_loaders import PyPDFLoader, DirectoryLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings

# Extract Data From the PDF File
def load_pdf_file(data_path):
    loader = DirectoryLoader(data_path,
                             glob="*.pdf",
                             loader_cls=PyPDFLoader)

    documents = loader.load()
    return documents

# Split the Data into Text Chunks
def text_split(extracted_data):
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
    text_chunks = text_splitter.split_documents(extracted_data)
    return text_chunks

# Download the Embeddings from HuggingFace 
def download_hugging_face_embeddings():
    # Modern approach: Using the provider's specific class if available, 
    # but HuggingFaceEmbeddings from community is standard for this tutorial.
    embeddings = HuggingFaceEmbeddings(model_name='sentence-transformers/all-MiniLM-L6-v2') 
    return embeddings
