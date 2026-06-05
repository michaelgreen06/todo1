import "dotenv/config";

import { argv, exit } from "node:process";

import { createDeviceToken, findOrCreateUserByEmail, initializeDatabase } from "./db.js";
import { createRawToken, hashRawToken } from "./token.js";
import { validateEmail } from "./validation.js";

const emailResult = validateEmail(argv[2] ?? null);
const rawDeviceName = argv[3];

if (!emailResult.ok || rawDeviceName === undefined || rawDeviceName.trim().length === 0) {
  console.error("Usage: npm run create-device-token -- user@example.com \"Michael phone\"");
  exit(1);
} else {
  initializeDatabase();
  const user = findOrCreateUserByEmail(emailResult.value);
  const rawToken = createRawToken();
  createDeviceToken(user.id, rawDeviceName.trim(), hashRawToken(rawToken));
  console.log(rawToken);
}
