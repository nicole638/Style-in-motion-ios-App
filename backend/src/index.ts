import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { sampleRouter } from "./routes/sample";
import { accountsRouter } from "./routes/accounts";
import { socialFollowersRouter } from "./routes/social-followers";
import { productInfoRouter } from "./routes/productInfo";
import { removeBackgroundRouter } from "./routes/removeBackground";
import { shopRedirectRouter } from "./routes/shop-redirect";
import { campaignsRouter } from "./routes/campaigns";
import { awinSyncRouter } from "./routes/awin-sync";
import { shareBeaconRouter } from "./routes/share-beacon";
import { logger } from "hono/logger";

const app = new Hono();

// CORS middleware - validates origin against allowlist
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

// Logging
app.use("*", logger());

// Health check endpoint
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/sample", sampleRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/social-followers", socialFollowersRouter);
app.route("/api/product-info", productInfoRouter);
app.route("/api/remove-background", removeBackgroundRouter);
app.route("/api/shop", shopRedirectRouter);
app.route("/api/campaigns", campaignsRouter);
app.route("/api/awin-sync", awinSyncRouter);
app.route("/api/share-beacon", shareBeaconRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  // Bun's default idleTimeout is 10s. ScrapingBee premium fetches for slow
  // merchants (Macy's, Bloomingdale's, Kohl's) routinely take 15-25s, which
  // hits the default and returns HTTP 000 / 502 to the client. 60s gives
  // ample headroom for the longest expected upstream while still bounding
  // hung connections.
  idleTimeout: 90,
};
