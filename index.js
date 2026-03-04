#!/usr/bin/env node

import { loadConfig } from "./src/config.js";
import { startApp } from "./src/App.js";

startApp(loadConfig());
