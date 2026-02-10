#!/usr/bin/env node
process.env.AGENTPANE_DATA_DIR ||= process.cwd()
import "../dist/index.js"
