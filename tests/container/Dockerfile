# syntax=docker/dockerfile:1.25
ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION} AS dependencies
COPY --chown=19001:19001 package.json package-lock.json /opt/check/
USER 19001:19001
ENV HOME=/tmp
RUN mkdir /tmp/dependencies && cp /opt/check/package*.json /tmp/dependencies/ && \
    cd /tmp/dependencies && npm ci --ignore-scripts --no-audit --no-fund

FROM node:${NODE_VERSION}
ENV HOME=/tmp
COPY --from=dependencies /tmp/dependencies/node_modules /opt/check/node_modules
COPY --chmod=0555 tests/container/check /opt/check/run
USER 19001:19001
WORKDIR /work
