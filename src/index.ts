import { bootstrap } from "./bootstrap.js";

bootstrap().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
