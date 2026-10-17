
const express = require("express");
const session = require("express-session");

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "cambiar-antes-de-produccion",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: "auto",
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.get("/", (req, res) => {
  res.send("WestcolClipsAI: servidor activo.");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "WestcolClipsAI" });
});

app.get("/callback", (req, res) => {
  res.status(200).send(
    "Ruta de retorno disponible. La autenticación OAuth todavía debe configurarse."
  );
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
  console.log(`WestcolClipsAI escuchando en el puerto ${port}`);
});
