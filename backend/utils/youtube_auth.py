"""
youtube_auth.py
Run once locally to generate YouTube OAuth2 credentials.
Usage: python backend/utils/youtube_auth.py
Paste the output JSON into your YOUTUBE_CREDENTIALS_JSON env var.
"""
import os
import json
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

def main():
    client_secrets = input("Path to downloaded client_secrets.json: ").strip()
    flow = InstalledAppFlow.from_client_secrets_file(client_secrets, SCOPES)
    creds = flow.run_local_server(port=0)
    output = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "token_uri": creds.token_uri,
    }
    print("\n── Copy this entire JSON into YOUTUBE_CREDENTIALS_JSON ──")
    print(json.dumps(output))

if __name__ == "__main__":
    main()
