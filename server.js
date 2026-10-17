
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000
    }
  })
);

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const REDIRECT_URI = "https://westcolclipsai.onrender.com/callback";

app.get("/", (req, res) => {
  res.send("WestcolClipsAI: servidor activo.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "WestcolClipsAI",
    oauthConfigured: Boolean(CLIENT_KEY && process.env.SESSION_SECRET)
  });
});

app.get("/auth/tiktok", (req, res) => {
  if (!CLIENT_KEY || !process.env.SESSION_SECRET) {
    return res.status(500).send("Falta configurar el servidor.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    response_type: "code",
    scope: "user.info.basic",
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect(
    "https://www.tiktok.com/v2/auth/authorize/?" + params.toString()
  );
});

app.get("/callback", (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(
      "TikTok no autorizó la solicitud: " +
      String(error_description || error)
    );
  }

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send(
      "Respuesta OAuth inválida o estado vencido. Intenta iniciar sesión otra vez."
    );
  }

  delete req.session.oauthState;

  res.status(200).send(
    "TikTok devolvió un código de autorización. Falta intercambiarlo por tokens para completar la integración."
  );
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
  console.log(`WestcolClipsAI escuchando en el puerto ${port}`);
});
