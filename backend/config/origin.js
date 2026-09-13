// Bu sunucunun tarayıcıdan erişilen adresi (storage URL'leri için).
// PORT .env'den gelir; server.js dotenv'i route'lardan önce yüklediği için
// burada okunduğunda hazırdır. Varsayılan kurulumun portu 3001.
export const SERVER_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;
