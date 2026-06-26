import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

export const jar = new CookieJar();

/** Single source of truth for the TIS host/origin, shared across the client and downloaders. */
export const TIS_HOST = "techinfo.toyota.com";
export const TIS_ORIGIN = `https://${TIS_HOST}`;

export const client = wrapper(
  axios.create({
    jar,
    baseURL: `${TIS_ORIGIN}/t3Portal/external/en/`,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.05",
      "Accept-Encoding": "gzip, deflate, br",
      Origin: TIS_ORIGIN,
      Connection: "keep-alive",
      Referer: `${TIS_ORIGIN}/`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Sec-GPC": "1",
    },
  })
);
