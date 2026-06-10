"""
services/saml_service.py
━━━━━━━━━━━━━━━━━━━━━━━━
Wraps python3-saml to provide SP settings for Okta SSO.
"""

import os
from pathlib import Path


def _read_cert(path: str) -> str:
    text = Path(path).read_text()
    return (
        text.replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace("\n", "")
            .strip()
    )


def _read_key(path: str) -> str:
    text = Path(path).read_text()
    return (
        text.replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("-----BEGIN RSA PRIVATE KEY-----", "")
            .replace("-----END RSA PRIVATE KEY-----", "")
            .replace("\n", "")
            .strip()
    )


def get_saml_settings() -> dict:
    base_url = os.getenv(
        "APP_BASE_URL",
        "https://ai-navigator-test-cbeedsgsd8hyfefq.northeurope-01.azurewebsites.net"
    ).rstrip("/")

    sp_cert = _read_cert("saml/sp.crt")
    sp_key  = _read_key("saml/sp.key")
    idp_cert = _read_cert("saml/idp.crt")

    return {
        "strict": True,
        "debug": False,
        "sp": {
            "entityId": f"{base_url}/saml/metadata",
            "assertionConsumerService": {
                "url": f"{base_url}/saml/acs",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": f"{base_url}/saml/logout",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert": sp_cert,
            "privateKey": sp_key,
        },
        "idp": {
            "entityId": "http://www.okta.com/exkwqo147yJiVkuyg417",
            "singleSignOnService": {
                "url": "https://onentt.okta.com/app/onentt_ainavigator_1/exkwqo147yJiVkuyg417/sso/saml",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": "https://onentt.okta.com/app/onentt_ainavigator_1/exkwqo147yJiVkuyg417/sso/saml",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": idp_cert,
        },
    }
