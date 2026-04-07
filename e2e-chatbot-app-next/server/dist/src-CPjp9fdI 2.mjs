import { n as getHostDomain, r as getHostUrl } from "./src-BaHhVWSg.mjs";

//#region ../packages/auth/src/databricks-auth.ts
let oauthToken = null;
let oauthTokenExpiresAt = 0;
let cliToken = null;
let cliTokenExpiresAt = 0;
let cliUserIdentity = null;
let cliUserIdentityExpiresAt = 0;
const USER_IDENTITY_CACHE_DURATION = 1800 * 1e3;
let cachedScimUser = null;
let cacheExpiry = 0;
/**
* Determine which authentication method to use
*/
function getAuthMethod() {
	if (shouldUseOAuth()) return "oauth";
	if (shouldUseCLIAuth()) return "cli";
	return "none";
}
/**
* Check if we should use OAuth authentication
*/
function shouldUseOAuth() {
	const clientId = process.env.DATABRICKS_CLIENT_ID;
	const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
	try {
		getHostDomain();
		return !!(clientId && clientSecret);
	} catch {
		return false;
	}
}
/**
* Check if we should use CLI-based OAuth U2M authentication
*/
function shouldUseCLIAuth() {
	const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
	const databricksHost = process.env.DATABRICKS_HOST;
	return !!(configProfile || databricksHost);
}
/**
* Get authentication method description for logging
*/
function getAuthMethodDescription() {
	const method = getAuthMethod();
	switch (method) {
		case "oauth": return "OAuth (service principal)";
		case "cli": return "CLI-based OAuth U2M";
		case "none": return "No authentication configured";
		default: return `Unknown method: ${method}`;
	}
}
/**
* Get the cached CLI host URL
* Returns null if no CLI host is cached or if cache has expired
*/
function getCachedCliHost() {
	if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) return cliHostCache.startsWith("https://") ? cliHostCache : `https://${cliHostCache}`;
	return null;
}
/**
* Get a fresh Databricks OAuth token, with caching
*/
async function getDatabricksOAuthToken() {
	if (oauthToken && Date.now() < oauthTokenExpiresAt) return oauthToken;
	const clientId = process.env.DATABRICKS_CLIENT_ID;
	const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
	const hostUrl = getHostUrl();
	if (!clientId || !clientSecret || !hostUrl) throw new Error("OAuth service principal authentication requires DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, and DATABRICKS_HOST environment variables");
	const tokenUrl = `${hostUrl.replace(/\/$/, "")}/oidc/v1/token`;
	const body = "grant_type=client_credentials&scope=all-apis";
	console.log("Buffer", Buffer);
	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to get OAuth token: ${response.status} ${errorText}`);
	}
	const data = await response.json();
	const accessToken = data.access_token;
	if (!accessToken) throw new Error("No access token received from OAuth response");
	oauthToken = accessToken;
	const expiresInSeconds = data.expires_in || 3600;
	const bufferSeconds = Math.min(600, Math.floor(expiresInSeconds * .2));
	oauthTokenExpiresAt = Date.now() + (expiresInSeconds - bufferSeconds) * 1e3;
	console.log(`[OAuth] Token acquired, expires in ${expiresInSeconds}s, will refresh in ${expiresInSeconds - bufferSeconds}s`);
	return accessToken;
}
let cliHostCache = null;
let cliHostCacheTime = 0;
const CLI_HOST_CACHE_DURATION = 600 * 1e3;
/**
* Get the current user's identity using the Databricks CLI
*/
async function getDatabricksUserIdentity() {
	if (cliUserIdentity && Date.now() < cliUserIdentityExpiresAt) return cliUserIdentity;
	const { spawnWithOutput } = await import("./src-OXRy6vs5.mjs");
	const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
	let host = process.env.DATABRICKS_HOST;
	if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) host = cliHostCache.replace(/^https?:\/\//, "").replace(/\/$/, "");
	else if (host) {
		const { getHostDomain: getHostDomain$1 } = await import("./src-OXRy6vs5.mjs");
		host = getHostDomain$1(host);
	}
	const args = [
		"auth",
		"describe",
		"--output",
		"json"
	];
	if (configProfile) args.push("--profile", configProfile);
	if (host) args.push("--host", host);
	try {
		const stdout = await spawnWithOutput("databricks", args, { errorMessagePrefix: "Databricks CLI auth describe failed" });
		const authData = JSON.parse(stdout);
		const username = authData.username;
		if (!username) throw new Error("No username found in CLI auth describe output");
		const responseHost = authData.details?.host;
		cliUserIdentity = username;
		cliUserIdentityExpiresAt = Date.now() + USER_IDENTITY_CACHE_DURATION;
		if (responseHost) {
			cliHostCache = responseHost;
			cliHostCacheTime = Date.now();
			console.log(`[CLI Auth] Host cached: ${responseHost}`);
		}
		console.log(`[CLI Auth] User identity acquired: ${username}`);
		return username;
	} catch (error) {
		if (error instanceof Error && error.message.includes("Failed to parse")) throw error;
		if (error instanceof Error && error.message.includes("exit code")) throw error;
		throw new Error(`Failed to execute Databricks CLI auth describe: ${error}`);
	}
}
/**
* Get a token using the Databricks CLI OAuth U2M authentication
*/
async function getDatabricksCliToken() {
	if (cliToken && Date.now() < cliTokenExpiresAt) return cliToken;
	const { spawnWithOutput } = await import("./src-OXRy6vs5.mjs");
	const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
	let host = process.env.DATABRICKS_HOST;
	if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) host = cliHostCache.replace(/^https?:\/\//, "").replace(/\/$/, "");
	else if (host) {
		const { getHostDomain: getHostDomain$1 } = await import("./src-OXRy6vs5.mjs");
		host = getHostDomain$1(host);
	}
	const args = ["auth", "token"];
	if (configProfile) args.push("--profile", configProfile);
	if (host) args.push("--host", host);
	try {
		const stdout = await spawnWithOutput("databricks", args, { errorMessagePrefix: "Databricks CLI auth token failed\nMake sure you have run \"databricks auth login\" first." });
		const tokenData = JSON.parse(stdout);
		if (!tokenData.access_token) throw new Error("No access_token found in CLI output");
		const expiresIn = tokenData.expires_in || 3600;
		cliToken = tokenData.access_token;
		const bufferSeconds = 300;
		cliTokenExpiresAt = Date.now() + (expiresIn - bufferSeconds) * 1e3;
		console.log(`[CLI Auth] Token acquired, expires in ${expiresIn}s, will refresh in ${expiresIn - bufferSeconds}s`);
		return tokenData.access_token;
	} catch (error) {
		if (error instanceof Error && error.message.includes("Failed to parse")) throw error;
		if (error instanceof Error && error.message.includes("exit code")) throw error;
		throw new Error(`Failed to execute Databricks CLI: ${error}\nMake sure the Databricks CLI is installed and in your PATH.`);
	}
}
/**
* Get a Databricks authentication token using the best available method
*/
async function getDatabricksToken() {
	const method = getAuthMethod();
	switch (method) {
		case "oauth": return getDatabricksOAuthToken();
		case "cli": return getDatabricksCliToken();
		case "none": throw new Error("No Databricks authentication configured. Please set one of:\n- DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET + DATABRICKS_HOST (OAuth)\n- DATABRICKS_CONFIG_PROFILE or DATABRICKS_HOST (CLI auth - run \"databricks auth login\" first)");
		default: throw new Error(`Unknown authentication method: ${method}`);
	}
}
/**
* Get the database username based on the authentication method
* For OAuth (service principal): use PGUSER environment variable
* For CLI auth (user): use the current user's identity
*/
async function getDatabaseUsername() {
	const method = getAuthMethod();
	switch (method) {
		case "oauth": {
			const pgUser = process.env.PGUSER;
			if (!pgUser) throw new Error("PGUSER environment variable must be set for OAuth authentication");
			return pgUser;
		}
		case "cli":
			console.log(`[CLI Auth] Using user identity for database role`);
			return await getDatabricksUserIdentity();
		case "none": throw new Error("No Databricks authentication configured");
		default: throw new Error(`Unknown authentication method: ${method}`);
	}
}
/**
* Get current user from Databricks SCIM API (for local development)
*/
async function getDatabricksCurrentUser() {
	if (cachedScimUser && Date.now() < cacheExpiry) {
		console.log("[getDatabricksCurrentUser] Using cached SCIM user data (expires in", Math.floor((cacheExpiry - Date.now()) / 1e3), "seconds)");
		return cachedScimUser;
	}
	console.log("[getDatabricksCurrentUser] Cache miss - fetching from SCIM API");
	const method = getAuthMethod();
	let hostUrl;
	let token;
	if (method === "cli") {
		await getDatabricksUserIdentity();
		if (cliHostCache) hostUrl = cliHostCache.startsWith("https://") ? cliHostCache : `https://${cliHostCache}`;
		else hostUrl = getHostUrl();
		token = await getDatabricksCliToken();
	} else {
		hostUrl = getHostUrl();
		token = await getDatabricksToken();
	}
	const authHeader = `Bearer ${token}`;
	const scimUrl = `${hostUrl}/api/2.0/preview/scim/v2/Me`;
	console.log("[getDatabricksCurrentUser] Fetching user from SCIM API:", scimUrl);
	const scimResponse = await fetch(scimUrl, { headers: {
		Authorization: authHeader,
		"Content-Type": "application/json"
	} });
	if (!scimResponse.ok) {
		const errorText = await scimResponse.text();
		throw new Error(`Failed to get SCIM user: ${scimResponse.status} ${errorText}`);
	}
	const scimUser = await scimResponse.json();
	console.log("[getDatabricksCurrentUser] SCIM user retrieved:", {
		id: scimUser.id,
		userName: scimUser.userName,
		displayName: scimUser.displayName,
		emails: scimUser.emails
	});
	cachedScimUser = scimUser;
	cacheExpiry = Date.now() + 1800 * 1e3;
	console.log("[getDatabricksCurrentUser] Cached SCIM user data for 30 minutes");
	return scimUser;
}
/**
* Main authentication function for all environments
*/
async function getAuthSession({ getRequestHeader }) {
	try {
		if (process.env.LOCAL_AUTH_BYPASS === "true") {
			const localUser = getRequestHeader("X-Forwarded-User") || process.env.USER || process.env.USERNAME || "local-user";
			const localEmail = getRequestHeader("X-Forwarded-Email") || `${localUser}@localhost`;
			const localName = getRequestHeader("X-Forwarded-Preferred-Username") || localUser;
			return { user: {
				id: localUser,
				email: localEmail,
				name: localName,
				preferredUsername: localName,
				type: "regular"
			} };
		}
		if (isTestEnvironment) {
			const fwdUser = getRequestHeader("X-Forwarded-User") ?? "test-user-id";
			const fwdEmail = getRequestHeader("X-Forwarded-Email") ?? "test@example.com";
			const fwdName = getRequestHeader("X-Forwarded-Preferred-Username") ?? "test-user";
			const user$1 = await getUserFromHeaders({ getRequestHeader: (name) => {
				if (name === "X-Forwarded-User") return fwdUser;
				if (name === "X-Forwarded-Email") return fwdEmail;
				if (name === "X-Forwarded-Preferred-Username") return fwdName;
				return null;
			} });
			return { user: {
				id: user$1.id,
				email: user$1.email || fwdEmail,
				name: fwdName,
				preferredUsername: fwdName,
				type: "regular"
			} };
		}
		if (getRequestHeader("X-Forwarded-User")) {
			console.log("[getAuthSession] Using Databricks Apps headers");
			const forwardedUser = getRequestHeader("X-Forwarded-User");
			const forwardedEmail = getRequestHeader("X-Forwarded-Email");
			const forwardedPreferredUsername = getRequestHeader("X-Forwarded-Preferred-Username");
			const user$1 = await getUserFromHeaders({ getRequestHeader });
			return { user: {
				id: user$1.id,
				email: user$1.email || forwardedEmail || "",
				name: forwardedPreferredUsername || forwardedUser || void 0,
				preferredUsername: forwardedPreferredUsername || void 0,
				type: "regular"
			} };
		}
		console.log("[getAuthSession] Using SCIM API for local development");
		const scimUser = await getDatabricksCurrentUser();
		const primaryEmail = scimUser.emails?.find((e) => e.primary)?.value || scimUser.emails?.[0]?.value || `${scimUser.userName}@databricks.com`;
		const user = await getUserFromHeaders({ getRequestHeader: (name) => {
			if (name === "X-Forwarded-User") return scimUser.id;
			if (name === "X-Forwarded-Email") return primaryEmail;
			if (name === "X-Forwarded-Preferred-Username") return scimUser.userName;
			return null;
		} });
		return { user: {
			id: user.id,
			email: user.email || primaryEmail,
			name: scimUser.displayName || scimUser.userName,
			preferredUsername: scimUser.userName,
			type: "regular"
		} };
	} catch (error) {
		console.error("[getAuthSession] Failed to get session:", error);
		return null;
	}
}
const isTestEnvironment = process.env.PLAYWRIGHT === "True";
/**
* Get user from request headers
* Used by getAuthSession to extract user information
*/
async function getUserFromHeaders({ getRequestHeader }) {
	const forwardedUser = getRequestHeader("X-Forwarded-User");
	const forwardedEmail = getRequestHeader("X-Forwarded-Email");
	const forwardedPreferredUsername = getRequestHeader("X-Forwarded-Preferred-Username");
	let user;
	if (forwardedUser) user = {
		id: forwardedUser,
		email: forwardedEmail || `${forwardedPreferredUsername ?? forwardedUser}@databricks.com`
	};
	else user = {
		id: process.env.USER || process.env.USERNAME || "local-user",
		email: `${process.env.USER || process.env.USERNAME || "local-user"}@localhost`
	};
	console.log(`[getUserFromHeaders] Returning user from headers:`, user);
	return user;
}

//#endregion
export { getDatabaseUsername as a, getCachedCliHost as i, getAuthMethodDescription as n, getDatabricksToken as o, getAuthSession as r, getDatabricksUserIdentity as s, getAuthMethod as t };