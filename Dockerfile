FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# The API, isolated credential broker, and LiveKit worker share Python modules.
# Install the union of their requirements so Railway can use this same image
# with a service-specific start command.
COPY backend/requirements.txt /tmp/backend-requirements.txt
COPY agent/requirements.txt /tmp/agent-requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r /tmp/backend-requirements.txt -r /tmp/agent-requirements.txt

COPY backend/ ./backend/
COPY agent/ ./agent/
COPY db/ ./db/
COPY frontend/src/lib/assistantPolicy.json ./frontend/src/lib/assistantPolicy.json

# Use a non-root runtime identity. Railway overrides this default command for
# the credential broker and LiveKit worker services.
RUN groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app \
    && chown -R app:app /home/app
USER app

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
