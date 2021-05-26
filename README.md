# @sebbo2002/release-bot

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

This is a small GitHub action that is supposed to help me release stuff. Usually, I forget to do releases, so I built this.
The bot runs [semantic release](https://semantic-release.gitbook.io/semantic-release/) and creates pull requests
[like this one](https://github.com/sebbo2002/ical-generator/pull/240) when there is something to release.


## ⚡️ Example

```yaml
name: ReleaseBot
on:
  workflow_dispatch:
  push:
    branches: ['develop']
  schedule:
    - cron: '0 6 * * 0'

jobs:
  release-bot:
    runs-on: ubuntu-latest
    steps:
      - name: ☁️ Checkout Project
        uses: actions/checkout@v2
      - name: ☁️ Checkout ReleaseBot
        uses: actions/checkout@v2
        with:
          repository: sebbo2002/release-bot
          path: ./.actions/release-bot
      - name: 🔧 Setup npm cache
        uses: actions/cache@v2
        with:
          path: ~/.npm
          key: ${{ runner.os }}-releasebot-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-releasebot-
      - name: 📦 Install Dependencies
        run: npm ci
        working-directory: ./.actions/release-bot
      - name: 🤖 Run ReleaseBot
        uses: ./.actions/release-bot
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

```


## 🙆🏼‍♂️ Copyright and license

Copyright (c) Sebastian Pekarek under the [MIT license](LICENSE).
