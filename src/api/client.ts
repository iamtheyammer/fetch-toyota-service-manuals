import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

export const jar = new CookieJar();

export const client = wrapper(
  axios.create({
    jar,
    baseURL: "https://techinfo.toyota.com/t3Portal/external/en/",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.05",
      "Accept-Encoding": "gzip, deflate, br",
      Origin: "https://techinfo.toyota.com",
      Connection: "keep-alive",
      Referer: "https://techinfo.toyota.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Sec-GPC": "1",
    },
  })
);
