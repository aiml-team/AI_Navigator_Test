from fastapi import APIRouter, HTTPException, UploadFile, File
from services.chromadb_store import policy_collection
from services.file_utils import extract_pdf_text as _extract_pdf_text, extract_docx_text as _extract_docx_text

router = APIRouter()


@router.post("/api/upload-policy")
async def upload_policy(file: UploadFile = File(...)):
    content  = await file.read()
    filename = file.filename or ""
    ext      = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        text = _extract_pdf_text(content)
    elif ext == "docx":
        text = _extract_docx_text(content)
    else:
        text = content.decode("utf-8", errors="ignore")

    if not text or not text.strip():
        raise HTTPException(400, "Could not extract any text from the uploaded file. "
                                 "Ensure the file contains readable text.")

    chunks    = [text[i:i+500] for i in range(0, len(text), 500) if text[i:i+500].strip()]
    if not chunks:
        raise HTTPException(400, "File appears empty after text extraction.")

    ids       = [f"{filename}_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk": i} for i in range(len(chunks))]

    try:
        existing = policy_collection.get(where={"source": filename})
        if existing["ids"]:
            policy_collection.delete(ids=existing["ids"])
    except Exception:
        pass

    policy_collection.add(documents=chunks, ids=ids, metadatas=metadatas)
    return {"status": "ok", "filename": filename, "chunks_indexed": len(chunks)}


@router.get("/api/policies")
async def list_policies():
    try:
        result  = policy_collection.get()
        sources = list(set(m.get("source", "unknown") for m in (result.get("metadatas") or [])))
        return {"sources": sources, "total_chunks": len(result.get("ids") or [])}
    except Exception:
        return {"sources": [], "total_chunks": 0}


@router.delete("/api/policies/{filename}")
async def delete_policy(filename: str):
    try:
        existing = policy_collection.get(where={"source": filename})
        if existing["ids"]:
            policy_collection.delete(ids=existing["ids"])
            return {"status": "ok"}
        return {"status": "not_found"}
    except Exception as e:
        raise HTTPException(500, str(e))
