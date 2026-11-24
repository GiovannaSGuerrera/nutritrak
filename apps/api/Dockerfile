FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STORE_BACKEND=sqlite DATA_DIR=/srv/data
WORKDIR /srv/app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY apps/api/src ./apps/api/src
COPY apps/api/scripts ./apps/api/scripts
COPY apps/web/public ./apps/web/public
RUN mkdir -p /srv/data && chown node:node /srv/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/api/src/server.js"]
