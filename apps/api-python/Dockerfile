FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/srv/app
WORKDIR /srv/app
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
RUN useradd --system --uid 10001 app
COPY app ./app
COPY alembic.ini ./alembic.ini
COPY migrations ./migrations
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test
USER root
COPY requirements-dev.lock ./requirements-dev.lock
RUN pip install --no-cache-dir --require-hashes -r requirements-dev.lock
COPY tests ./tests
USER app
CMD ["pytest", "-q"]

FROM base AS runtime
