
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();

app.set("trust proxy", 1);

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

const REDIRECT_URI =
  "https://westcolclipsai.onrender.com/callback";

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

app.use(express.urlencoded({ extended: false }));

app.use(
  express.raw({
    type: [
      "video/mp4",
      "video/quicktime",
      "video/webm"
    ],
    limit: "100mb"
  })
);

app.use(express.json());

app.use(
  session({
    name: "westcolclipsai.sid",
    secret: SESSION_SECRET || "configura-SESSION_SECRET-en-Render",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 2 * 60 * 60 * 1000
    }
  })
);

// Página principal
app.get("/", (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>WestcolClipsAI</title>
    </head>
    <body style="font-family:Arial;max-width:650px;margin:40px auto;padding:20px">
      <h1>WestcolClipsAI</h1>
      <p>Conecta tu cuenta de TikTok y prepara tus clips.</p>
      <p><a href="/auth/tiktok">Conectar con TikTok</a></p>
      <p><a href="/tiktok/profile">Consultar perfil conectado</a></p>
      <p><a href="/tiktok/upload">Enviar un video a TikTok</a></p>
    </body>
    </html>
  `);
});

// Estado del servidor
app.get("/health", (req, res) => {
  res.json({
    estado: "ok",
    app: "WestcolClipsAI",
    oauthConfigured: Boolean(
      CLIENT_KEY && CLIENT_SECRET && SESSION_SECRET
    )
  });
});

// Iniciar conexión OAuth
app.get("/auth/tiktok", (req, res) => {
  if (!CLIENT_KEY || !CLIENT_SECRET || !SESSION_SECRET) {
    return res.status(500).send(
      "Falta configurar las variables de entorno en Render."
    );
  }

  const state = crypto.randomBytes(24).toString("hex");

  req.session.oauthState = state;

  req.session.save((err) => {
    if (err) {
      console.error("Error guardando sesión OAuth:", err.message);

      return res.status(500).send(
        "No fue posible iniciar la conexión con TikTok."
      );
    }

    const params = new URLSearchParams({
      client_key: CLIENT_KEY,
      response_type: "code",
      scope: "user.info.basic,video.upload",
      redirect_uri: REDIRECT_URI,
      state
    });

    res.redirect(
      "https://www.tiktok.com/v2/auth/authorize/?" +
      params.toString()
    );
  });
});

// Retorno de autorización OAuth
app.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(
      "TikTok no autorizó la solicitud: " +
      String(error_description || error)
    );
  }

  if (
    !code ||
    !state ||
    typeof state !== "string" ||
    state !== req.session.oauthState
  ) {
    return res.status(400).send(
      "Respuesta OAuth inválida o vencida. Conecta TikTok otra vez."
    );
  }

  delete req.session.oauthState;

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_key: CLIENT_KEY,
          client_secret: CLIENT_SECRET,
          code: String(code),
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (
      !response.ok ||
      data.error ||
      !data.access_token
    ) {
      console.error("Error al obtener token OAuth:", {
        estadoHTTP: response.status,
        codigo: data.error || "respuesta_invalida"
      });

      return res.status(400).send(
        "TikTok no permitió completar la autorización. Revisa los registros de Render."
      );
    }

    req.session.tiktokAccessToken = data.access_token;
    req.session.tiktokRefreshToken = data.refresh_token || null;

    // Guardar la sesión antes de redirigir al perfil
    req.session.save((err) => {
      if (err) {
        console.error("Error guardando sesión TikTok:", err.message);

        return res.status(500).send(
          "TikTok autorizó la conexión, pero no se pudo guardar la sesión. Intenta conectar otra vez."
        );
      }

      res.redirect("/tiktok/profile");
    });
  } catch (err) {
    console.error("Error OAuth:", err.message);

    res.status(500).send(
      "No fue posible conectar con TikTok."
    );
  }
});

// Consultar perfil conectado
app.get("/tiktok/profile", async (req, res) => {
  const token = req.session.tiktokAccessToken;

  if (!token) {
    return res.status(401).send(
      'Primero <a href="/auth/tiktok">conecta TikTok</a>.'
    );
  }

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok || data.error?.code !== "ok") {
      return res.status(400).json({
        error: "No se pudo consultar el perfil.",
        detalle: data.error?.code || "Error de TikTok"
      });
    }

    res.json({
      conectado: true,
      mensaje: "Perfil consultado correctamente.",
      usuario: data.data.user
    });
  } catch (err) {
    console.error("Error consultando perfil:", err.message);

    res.status(500).json({
      error: "No fue posible consultar el perfil."
    });
  }
});

// Formulario de envío de videos
app.get("/tiktok/upload", (req, res) => {
  if (!req.session.tiktokAccessToken) {
    return res.redirect("/auth/tiktok");
  }

  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Enviar clip a TikTok</title>
    </head>
    <body style="font-family:Arial;max-width:650px;margin:40px auto;padding:20px">
      <h1>Enviar clip a TikTok</h1>
      <p>Selecciona un video MP4, MOV o WebM de máximo 100 MB.</p>

      <form id="form">
        <input
          id="video"
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          required
        >
        <p>
          <button id="submit" type="submit">Enviar a TikTok</button>
        </p>
      </form>

      <p id="resultado" role="status"></p>

      <script>
        const form = document.getElementById("form");
        const resultado = document.getElementById("resultado");
        const boton = document.getElementById("submit");

        form.addEventListener("submit", async (event) => {
          event.preventDefault();

          const file = document.getElementById("video").files[0];

          if (!file) return;

          if (file.size > 100 * 1024 * 1024) {
            resultado.textContent = "El video supera los 100 MB.";
            return;
          }

          const tipos = [
            "video/mp4",
            "video/quicktime",
            "video/webm"
          ];

          if (!tipos.includes(file.type)) {
            resultado.textContent =
              "Formato no compatible. Usa MP4, MOV o WebM.";
            return;
          }

          boton.disabled = true;
          resultado.textContent =
            "Transfiriendo el video. Espera hasta recibir el resultado...";

          try {
            const response = await fetch("/tiktok/video/upload", {
              method: "POST",
              headers: {
                "Content-Type": file.type
              },
              body: file
            });

            const data = await response.json();

            if (response.ok && data.enviado) {
              resultado.textContent =
                data.mensaje +
                " ID: " + data.publish_id;
            } else {
              resultado.textContent =
                "Error: " +
                (data.error || "No se pudo enviar el video.") +
                (data.estado ? " HTTP: " + data.estado : "") +
                (data.detalle ? " Detalle: " + data.detalle : "");
            }
          } catch (err) {
            resultado.textContent =
              "No se pudo completar la solicitud. Revisa la conexión e inténtalo más tarde.";
          } finally {
            boton.disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Enviar video a la bandeja de entrada de TikTok
app.post("/tiktok/video/upload", async (req, res) => {
  const token = req.session.tiktokAccessToken;
  const video = req.body;
  const contentType = req.headers["content-type"];

  if (!token) {
    return res.status(401).json({
      error: "Sesión vencida. Conecta TikTok otra vez."
    });
  }

  if (!Buffer.isBuffer(video) || video.length === 0) {
    return res.status(400).json({
      error: "No se recibió el archivo de video."
    });
  }

  const tipos = [
    "video/mp4",
    "video/quicktime",
    "video/webm"
  ];

  if (!tipos.includes(contentType)) {
    return res.status(400).json({
      error: "Formato no compatible."
    });
  }

  const size = video.length;

  if (size > MAX_VIDEO_SIZE) {
    return res.status(413).json({
      error: "El video supera los 100 MB."
    });
  }

  try {
    // Archivos de hasta 64 MB se envían en un bloque.
    // Archivos mayores se dividen en bloques de aproximadamente 10 MB.
    const chunkSize =
      size <= MAX_SINGLE_CHUNK
        ? size
        : Math.ceil(size / Math.ceil(size / CHUNK_SIZE));

    const totalChunks = Math.ceil(size / chunkSize);

    const initResponse = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
          source_info: {
            source: "FILE_UPLOAD",
            video_size: size,
            chunk_size: chunkSize,
            total_chunk_count: totalChunks
          }
        })
      }
    );

    const initData = await initResponse.json();

    if (
      !initResponse.ok ||
      initData.error?.code !== "ok" ||
      !initData.data?.upload_url ||
      !initData.data?.publish_id
    ) {
      console.error("Error al iniciar transferencia:", {
        estadoHTTP: initResponse.status,
        codigo: initData.error?.code || "respuesta_invalida",
        mensaje: initData.error?.message || ""
      });

      return res.status(502).json({
        error: "TikTok no aceptó iniciar la transferencia.",
        detalle: initData.error?.code ||
          "Error de inicialización",
        estado: initResponse.status
      });
    }

    const uploadUrl = initData.data.upload_url;
    const publishId = initData.data.publish_id;

    let offset = 0;

    for (let i = 0; i < totalChunks; i++) {
      const end = Math.min(offset + chunkSize, size);
      const part = video.subarray(offset, end);

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(part.length),
          "Content-Range": `bytes ${offset}-${end - 1}/${size}`
        },
        body: part
      });

      // TikTok espera 201 para el archivo completo o el último bloque,
      // y 206 para los bloques intermedios.
      const expectedStatus =
        i === totalChunks - 1 ? 201 : 206;

      if (uploadResponse.status !== expectedStatus) {
        const responseText = await uploadResponse.text().catch(() => "");

        console.error("Respuesta inesperada en la transferencia:", {
          bloque: i + 1,
          totalBloques: totalChunks,
          estadoHTTP: uploadResponse.status,
          estadoEsperado: expectedStatus,
          respuesta: responseText.slice(0, 1000)
        });

        return res.status(502).json({
          error: "TikTok devolvió una respuesta inesperada al transferir el video.",
          bloque: i + 1,
          total_bloques: totalChunks,
          estado: uploadResponse.status,
          estado_esperado: expectedStatus
        });
      }

      offset = end;
    }

    console.log("Transferencia completada:", {
      publishId,
      bytes: size,
      totalBloques: totalChunks
    });

    return res.json({
      enviado: true,
      mensaje: "Transferencia completada. TikTok debe procesar el envío y notificarte para continuar.",
      publish_id: publishId,
      bytes: size,
      bloques: totalChunks
    });
  } catch (err) {
    console.error("Error de transferencia:", err.message);

    return res.status(500).json({
      error: "No fue posible completar la transferencia del video."
    });
  }
});

// Consultar estado de un envío existente
app.get("/tiktok/status", async (req, res) => {
  const token = req.session.tiktokAccessToken;
  const publishId = req.query.publish_id;

  if (!token) {
    return res.status(401).json({
      error: "Sesión vencida. Conecta TikTok otra vez."
    });
  }

  if (
    typeof publishId !== "string" ||
    !/^v_inbox_file~v2\.[A-Za-z0-9_-]+$/.test(publishId)
  ) {
    return res.status(400).json({
      error: "ID de envío no válido."
    });
  }

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
          publish_id: publishId
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      estado_http: response.status,
      resultado: data.data || null,
      error: data.error || null
    });
  } catch (err) {
    console.error("Error consultando estado:", err.message);

    return res.status(500).json({
      error: "No fue posible consultar el estado."
    });
  }
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
  console.log(`WestcolClipsAI escuchando en el puerto ${port}`);
});
