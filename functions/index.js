const functions = require("firebase-functions");
const axios = require("axios");
const cors = require("cors")({ origin: true });

exports.apiProxy = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const TARGET_URL = "https://ywe3crmpll.execute-api.us-east-2.amazonaws.com/stage";
    // In V1, we can pull the key directly from process.env since we have the .env file in the functions folder
    const apiKey = process.env.FP_API_KEY;

    // Strip '/api' from the path if it exists
    const path = req.path.replace(/^\/api/, '');

    try {
      const targetResponse = await axios({
        method: req.method,
        url: `${TARGET_URL}${path}`,
        headers: {
          "x-api-key": apiKey,
        },
        params: req.query,
        data: req.body,
      });

      res.status(targetResponse.status).send(targetResponse.data);
    } catch (error) {
      console.error("API Proxy Error:", error.message);
      if (error.response) {
        res.status(error.response.status).send(error.response.data);
      } else {
        res.status(500).send({ error: "Internal Server Error" });
      }
    }
  });
});
