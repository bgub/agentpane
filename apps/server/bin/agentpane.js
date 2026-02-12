#!/usr/bin/env bun
import { homedir } from "node:os"
import { join } from "node:path"
process.env.AGENTPANE_DATA_DIR ||= join(homedir(), ".agentpane")
import "../dist/index.js"
