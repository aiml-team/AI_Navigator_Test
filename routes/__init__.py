from fastapi import APIRouter

from routes.run import router as run_router
from routes.clarifier import router as clarifier_router
from routes.tools import router as tools_router
from routes.audit import router as audit_router
from routes.feedback import router as feedback_router
from routes.policies import router as policies_router
from routes.scenarios import router as scenarios_router
from routes.prompt_versions import router as prompt_versions_router
from routes.refine import router as refine_router
from routes.auth_routes import router as auth_router
from routes.personalization import router as personalization_router
from routes.technical_feedback import router as tech_feedback_router
from routes.saved_scenarios import router as saved_scenarios_router
# ── OKTA-DISABLED ─ uncomment the next line to re-enable Okta SSO routes
# from routes.saml_routes import router as saml_router

router = APIRouter()

router.include_router(run_router)
router.include_router(clarifier_router)
router.include_router(tools_router)
router.include_router(audit_router)
router.include_router(feedback_router)
router.include_router(policies_router)
router.include_router(scenarios_router)
router.include_router(prompt_versions_router)
router.include_router(refine_router)
router.include_router(auth_router)
router.include_router(personalization_router)
router.include_router(tech_feedback_router)
router.include_router(saved_scenarios_router)
# ── OKTA-DISABLED ─ uncomment the next line to re-enable Okta SSO routes
# router.include_router(saml_router)
