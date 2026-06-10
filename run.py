import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["./"],
        reload_excludes=[
            ".venv",
            "MYENV",
            "chroma_db",
            "__pycache__",
            "*.pyc",
            "orchestrator.db",
            "static",
            "templates",
            "saml",
            "*.xlsx",
        ],
    )
