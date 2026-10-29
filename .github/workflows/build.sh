#!/usr/bin/env bash
set -e

echo "########################"
echo "# build.sh"
echo "# Branch = ${BRANCH}"
echo "# node version = $(node -v)"
echo "# npm version = $(npm -v)"
echo "########################"

# Rollup Build in ./dist
npm run build
