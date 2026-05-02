from setuptools import find_packages, setup

setup(
    name = 'medveda-ai',
    version= '0.0.0',
    author= 'Antigravity AI',
    author_email= 'ai@example.com',
    packages= find_packages(),
    install_requires = [
        "fastapi",
        "uvicorn",
        "duckduckgo-search",
        "langchain",
        "langchain-groq",
        "langchain-pinecone",
        "langchain-openai",
        "sentence-transformers",
        "pypdf",
        "python-dotenv"
    ]
)
