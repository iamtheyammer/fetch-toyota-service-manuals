import { client } from "./client";

/**
 * login logs in with the user's email and password.
 * Since it just adds cookies to the jar, it doesn't need to return anything.
 * @param email
 * @param password
 */
export default async function login(
  email: string,
  password: string
): Promise<void> {
  await client({
    method: "POST",
    url: "https://ep.fram.idm.toyota.com/openam/json/realms/root/realms/dealerdaily/authenticate",
    params: {
      authIndexType: "service",
      authIndexValue: "Techinfo",
    },
    headers: {
      "x-requested-with": "X-FR-TMNA-Rest-API",
      "x-openam-username": email,
      "x-openam-password": password,
    },
  });

  // this request sets the session
  await client({
    method: "GET",
    url: "https://techinfo.toyota.com/t3Portal/",
  });
}
