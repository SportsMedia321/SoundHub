"""
Cloudflare R2 storage client (S3-compatible via boto3).
Handles upload, download, presigned URLs, and deletion.
"""
import os
import boto3
from botocore.config import Config
from pathlib import Path


def get_r2():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


BUCKET = os.environ.get("R2_BUCKET_NAME", "soundhub")


def upload_file(local_path: str, r2_key: str, content_type: str = "video/mp4") -> str:
    """Upload a local file to R2. Returns the r2_key."""
    r2 = get_r2()
    r2.upload_file(
        local_path,
        BUCKET,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )
    return r2_key


def download_file(r2_key: str, local_path: str) -> str:
    """Download a file from R2 to local path. Returns local_path."""
    r2 = get_r2()
    Path(local_path).parent.mkdir(parents=True, exist_ok=True)
    r2.download_file(BUCKET, r2_key, local_path)
    return local_path


def delete_file(r2_key: str):
    """Delete a single file from R2."""
    r2 = get_r2()
    r2.delete_object(Bucket=BUCKET, Key=r2_key)


def delete_files(r2_keys: list):
    """Batch delete files from R2."""
    if not r2_keys:
        return
    r2 = get_r2()
    objects = [{"Key": k} for k in r2_keys]
    r2.delete_objects(Bucket=BUCKET, Delete={"Objects": objects})


def presigned_url(r2_key: str, expires: int = 3600) -> str:
    """Generate a presigned URL for temporary access."""
    r2 = get_r2()
    return r2.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": r2_key},
        ExpiresIn=expires,
    )


def upload_audio(local_path: str, audio_id: str, ext: str = "mp3") -> str:
    """Upload audio snippet to library folder."""
    key = f"audio_library/{audio_id}.{ext}"
    ct = {"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac"}
    return upload_file(local_path, key, ct.get(ext, "audio/mpeg"))


def upload_raw_clip(local_path: str, clip_id: str) -> str:
    """Upload raw downloaded clip."""
    key = f"clips/raw/{clip_id}.mp4"
    return upload_file(local_path, key, "video/mp4")


def upload_composed_clip(local_path: str, clip_id: str, platform: str) -> str:
    """Upload platform-specific composed clip."""
    key = f"clips/composed/{clip_id}_{platform}.mp4"
    return upload_file(local_path, key, "video/mp4")


def delete_clip_files(clip_id: str, platforms: list = None):
    """Delete all files for a clip after publishing."""
    keys = [f"clips/raw/{clip_id}.mp4"]
    for plat in (platforms or ["tiktok", "instagram", "youtube"]):
        keys.append(f"clips/composed/{clip_id}_{plat}.mp4")
    delete_files(keys)
