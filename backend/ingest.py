import os
import time
from src.helper import download_hugging_face_embeddings, load_pdf_file, text_split, generate_ids
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone
from dotenv import load_dotenv

load_dotenv()

PINECONE_API_KEY = os.environ.get('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.environ.get('PINECONE_INDEX_NAME')

def ingest_data(clear_index=False):
    # 1. Load Data
    print("Loading PDF data...")
    extracted_data = load_pdf_file("data/")
    
    # 2. Split Data
    print("Splitting data into chunks...")
    text_chunks = text_split(extracted_data)
    
    # 3. Generate Unique IDs for Deduplication
    print("Generating unique IDs for chunks...")
    ids = generate_ids(text_chunks)
    
    # 4. Download Embeddings
    print("Downloading embeddings model...")
    embeddings = download_hugging_face_embeddings()
    
    # 5. Connect to Pinecone
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = pc.Index(PINECONE_INDEX_NAME)
    
    if clear_index:
        print(f"Clearing all existing data from index: {PINECONE_INDEX_NAME}...")
        index.delete(delete_all=True)
    
    # 6. Push to Pinecone with specific IDs
    print(f"Pushing/Updating {len(text_chunks)} chunks in Pinecone index: {PINECONE_INDEX_NAME}...")
    
    # We use the existing index and add documents with IDs. 
    # If an ID already exists, Pinecone will overwrite (update) it instead of duplicating.
    vectorstore = PineconeVectorStore(
        index=index,
        embedding=embeddings,
        pinecone_api_key=PINECONE_API_KEY
    )
    
    # Add documents in batches to avoid timeout or payload limits
    batch_size = 100
    for i in range(0, len(text_chunks), batch_size):
        batch_chunks = text_chunks[i:i + batch_size]
        batch_ids = ids[i:i + batch_size]
        
        # Retry logic for each batch
        max_retries = 3
        retry_delay = 5  # seconds
        for attempt in range(max_retries):
            try:
                vectorstore.add_documents(documents=batch_chunks, ids=batch_ids)
                break  # Success, move to next batch
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"\nError uploading batch {i//batch_size + 1}: {e}")
                    print(f"Retrying in {retry_delay} seconds... (Attempt {attempt + 2}/{max_retries})")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    print(f"\nFailed to upload batch {i//batch_size + 1} after {max_retries} attempts.")
                    raise e

        print(f"Uploaded batch {i//batch_size + 1}/{(len(text_chunks)-1)//batch_size + 1}")

    print("Ingestion and cleaning completed successfully!")

if __name__ == "__main__":
    if not PINECONE_API_KEY or not PINECONE_INDEX_NAME:
        print("Error: Please set PINECONE_API_KEY and PINECONE_INDEX_NAME in your .env file.")
    else:
        # Ask user if they want to clear the index first to remove old duplicates
        choice = input("Do you want to clear the existing index before ingestion? (y/n): ").lower()
        should_clear = True if choice == 'y' else False
        ingest_data(clear_index=should_clear)
