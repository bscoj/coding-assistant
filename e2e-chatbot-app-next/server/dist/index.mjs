import { a as message, c as desc, d as gt, f as gte, h as sql, i as chat, l as and, m as lt, n as isDatabaseAvailable, o as vote, p as inArray, r as drizzle, s as asc, u as eq } from "./connection-pool-A5LR0aAb.mjs";
import "./src-BaHhVWSg.mjs";
import { n as getAuthMethodDescription, o as getDatabricksToken, r as getAuthSession, t as getAuthMethod } from "./src-CPjp9fdI.mjs";
import { t as src_default$1 } from "./src-CdTKJz_q.mjs";
import { n as CONTEXT_HEADER_USER_ID, o as getEndpointOboInfo, s as getWorkspaceHostname, t as CONTEXT_HEADER_CONVERSATION_ID } from "./src-B1aiqSAD.mjs";
import dotenv from "dotenv";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import cors from "cors";
import { convertToModelMessages, createUIMessageStream, generateText, pipeUIMessageStreamToResponse, streamText } from "ai";
import { z } from "zod";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import fs from "node:fs";

//#region src/env.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename);
if (!process.env.TEST_MODE) dotenv.config({
	path: path.resolve(__dirname$1, "../..", ".env"),
	override: false
});

//#endregion
//#region ../packages/core/src/types.ts
z.object({ createdAt: z.string() });

//#endregion
//#region ../packages/core/src/errors.ts
const visibilityBySurface = {
	database: "log",
	chat: "response",
	auth: "response",
	api: "response",
	history: "response",
	stream: "response",
	message: "response"
};
var ChatSDKError = class extends Error {
	type;
	surface;
	statusCode;
	cause;
	constructor(errorCode, cause) {
		super();
		let type;
		let surface;
		try {
			const [_type, _surface] = errorCode.split(":");
			type = _type;
			surface = _surface;
		} catch (error) {
			console.error("Error parsing error code:", error);
			throw new Error("Invalid error code");
		}
		this.type = type;
		this.cause = cause;
		this.surface = surface;
		this.message = getMessageByErrorCode(errorCode);
		this.statusCode = getStatusCodeByType(this.type);
	}
	toResponse() {
		const code = `${this.type}:${this.surface}`;
		const visibility = visibilityBySurface[this.surface];
		const { message: message$1, cause, statusCode } = this;
		if (visibility === "log") {
			console.error({
				code,
				message: message$1,
				cause
			});
			return {
				status: statusCode,
				json: {
					code: "",
					message: "Something went wrong. Please try again later."
				}
			};
		}
		return {
			status: statusCode,
			json: {
				code,
				message: message$1,
				cause
			}
		};
	}
};
function getMessageByErrorCode(errorCode) {
	if (errorCode.includes("database")) return "An error occurred while executing a database query.";
	switch (errorCode) {
		case "bad_request:api": return "The request couldn't be processed. Please check your input and try again.";
		case "unauthorized:auth": return "You need to sign in before continuing.";
		case "forbidden:auth": return "Your account does not have access to this feature.";
		case "rate_limit:chat": return "You have exceeded your maximum number of messages for the day. Please try again later.";
		case "not_found:chat": return "The requested chat was not found. Please check the chat ID and try again.";
		case "forbidden:chat": return "This chat belongs to another user. Please check the chat ID and try again.";
		case "unauthorized:chat": return "You need to sign in to view this chat. Please sign in and try again.";
		case "offline:chat": return "We're having trouble sending your message. Please check your internet connection and try again.";
		default: return "Something went wrong. Please try again later.";
	}
}
function getStatusCodeByType(type) {
	switch (type) {
		case "bad_request": return 400;
		case "unauthorized": return 401;
		case "forbidden": return 403;
		case "not_found": return 404;
		case "rate_limit": return 429;
		case "offline": return 503;
		case "empty": return 204;
		default: return 500;
	}
}

//#endregion
//#region ../packages/core/node_modules/date-fns/constants.js
/**
* @constant
* @name daysInYear
* @summary Days in 1 year.
*
* @description
* How many days in a year.
*
* One years equals 365.2425 days according to the formula:
*
* > Leap year occurs every 4 years, except for years that are divisible by 100 and not divisible by 400.
* > 1 mean year = (365+1/4-1/100+1/400) days = 365.2425 days
*/
const daysInYear = 365.2425;
/**
* @constant
* @name maxTime
* @summary Maximum allowed time.
*
* @example
* import { maxTime } from "./constants/date-fns/constants";
*
* const isValid = 8640000000000001 <= maxTime;
* //=> false
*
* new Date(8640000000000001);
* //=> Invalid Date
*/
const maxTime = Math.pow(10, 8) * 24 * 60 * 60 * 1e3;
/**
* @constant
* @name secondsInHour
* @summary Seconds in 1 hour.
*/
const secondsInHour = 3600;
/**
* @constant
* @name secondsInDay
* @summary Seconds in 1 day.
*/
const secondsInDay = secondsInHour * 24;
/**
* @constant
* @name secondsInWeek
* @summary Seconds in 1 week.
*/
const secondsInWeek = secondsInDay * 7;
/**
* @constant
* @name secondsInYear
* @summary Seconds in 1 year.
*/
const secondsInYear = secondsInDay * daysInYear;
/**
* @constant
* @name secondsInMonth
* @summary Seconds in 1 month
*/
const secondsInMonth = secondsInYear / 12;
/**
* @constant
* @name secondsInQuarter
* @summary Seconds in 1 quarter.
*/
const secondsInQuarter = secondsInMonth * 3;
/**
* @constant
* @name constructFromSymbol
* @summary Symbol enabling Date extensions to inherit properties from the reference date.
*
* The symbol is used to enable the `constructFrom` function to construct a date
* using a reference date and a value. It allows to transfer extra properties
* from the reference date to the new date. It's useful for extensions like
* [`TZDate`](https://github.com/date-fns/tz) that accept a time zone as
* a constructor argument.
*/
const constructFromSymbol = Symbol.for("constructDateFrom");

//#endregion
//#region ../packages/core/node_modules/date-fns/constructFrom.js
/**
* @name constructFrom
* @category Generic Helpers
* @summary Constructs a date using the reference date and the value
*
* @description
* The function constructs a new date using the constructor from the reference
* date and the given value. It helps to build generic functions that accept
* date extensions.
*
* It defaults to `Date` if the passed reference date is a number or a string.
*
* Starting from v3.7.0, it allows to construct a date using `[Symbol.for("constructDateFrom")]`
* enabling to transfer extra properties from the reference date to the new date.
* It's useful for extensions like [`TZDate`](https://github.com/date-fns/tz)
* that accept a time zone as a constructor argument.
*
* @typeParam DateType - The `Date` type, the function operates on. Gets inferred from passed arguments. Allows to use extensions like [`UTCDate`](https://github.com/date-fns/utc).
*
* @param date - The reference date to take constructor from
* @param value - The value to create the date
*
* @returns Date initialized using the given date and value
*
* @example
* import { constructFrom } from "./constructFrom/date-fns";
*
* // A function that clones a date preserving the original type
* function cloneDate<DateType extends Date>(date: DateType): DateType {
*   return constructFrom(
*     date, // Use constructor from the given date
*     date.getTime() // Use the date value to create a new date
*   );
* }
*/
function constructFrom(date, value) {
	if (typeof date === "function") return date(value);
	if (date && typeof date === "object" && constructFromSymbol in date) return date[constructFromSymbol](value);
	if (date instanceof Date) return new date.constructor(value);
	return new Date(value);
}

//#endregion
//#region ../packages/core/node_modules/date-fns/toDate.js
/**
* @name toDate
* @category Common Helpers
* @summary Convert the given argument to an instance of Date.
*
* @description
* Convert the given argument to an instance of Date.
*
* If the argument is an instance of Date, the function returns its clone.
*
* If the argument is a number, it is treated as a timestamp.
*
* If the argument is none of the above, the function returns Invalid Date.
*
* Starting from v3.7.0, it clones a date using `[Symbol.for("constructDateFrom")]`
* enabling to transfer extra properties from the reference date to the new date.
* It's useful for extensions like [`TZDate`](https://github.com/date-fns/tz)
* that accept a time zone as a constructor argument.
*
* **Note**: *all* Date arguments passed to any *date-fns* function is processed by `toDate`.
*
* @typeParam DateType - The `Date` type, the function operates on. Gets inferred from passed arguments. Allows to use extensions like [`UTCDate`](https://github.com/date-fns/utc).
* @typeParam ResultDate - The result `Date` type, it is the type returned from the context function if it is passed, or inferred from the arguments.
*
* @param argument - The value to convert
*
* @returns The parsed date in the local time zone
*
* @example
* // Clone the date:
* const result = toDate(new Date(2014, 1, 11, 11, 30, 30))
* //=> Tue Feb 11 2014 11:30:30
*
* @example
* // Convert the timestamp to date:
* const result = toDate(1392098430000)
* //=> Tue Feb 11 2014 11:30:30
*/
function toDate(argument, context) {
	return constructFrom(context || argument, argument);
}

//#endregion
//#region ../packages/core/node_modules/date-fns/_lib/addLeadingZeros.js
function addLeadingZeros(number, targetLength) {
	return (number < 0 ? "-" : "") + Math.abs(number).toString().padStart(targetLength, "0");
}

//#endregion
//#region ../packages/core/node_modules/date-fns/formatISO.js
/**
* The {@link formatISO} function options.
*/
/**
* @name formatISO
* @category Common Helpers
* @summary Format the date according to the ISO 8601 standard (https://support.sas.com/documentation/cdl/en/lrdict/64316/HTML/default/viewer.htm#a003169814.htm).
*
* @description
* Return the formatted date string in ISO 8601 format. Options may be passed to control the parts and notations of the date.
*
* @param date - The original date
* @param options - An object with options.
*
* @returns The formatted date string (in local time zone)
*
* @throws `date` must not be Invalid Date
*
* @example
* // Represent 18 September 2019 in ISO 8601 format (local time zone is UTC):
* const result = formatISO(new Date(2019, 8, 18, 19, 0, 52))
* //=> '2019-09-18T19:00:52Z'
*
* @example
* // Represent 18 September 2019 in ISO 8601, short format (local time zone is UTC):
* const result = formatISO(new Date(2019, 8, 18, 19, 0, 52), { format: 'basic' })
* //=> '20190918T190052'
*
* @example
* // Represent 18 September 2019 in ISO 8601 format, date only:
* const result = formatISO(new Date(2019, 8, 18, 19, 0, 52), { representation: 'date' })
* //=> '2019-09-18'
*
* @example
* // Represent 18 September 2019 in ISO 8601 format, time only (local time zone is UTC):
* const result = formatISO(new Date(2019, 8, 18, 19, 0, 52), { representation: 'time' })
* //=> '19:00:52Z'
*/
function formatISO(date, options) {
	const date_ = toDate(date, options?.in);
	if (isNaN(+date_)) throw new RangeError("Invalid time value");
	const format = options?.format ?? "extended";
	const representation = options?.representation ?? "complete";
	let result = "";
	let tzOffset = "";
	const dateDelimiter = format === "extended" ? "-" : "";
	const timeDelimiter = format === "extended" ? ":" : "";
	if (representation !== "time") {
		const day = addLeadingZeros(date_.getDate(), 2);
		const month = addLeadingZeros(date_.getMonth() + 1, 2);
		result = `${addLeadingZeros(date_.getFullYear(), 4)}${dateDelimiter}${month}${dateDelimiter}${day}`;
	}
	if (representation !== "date") {
		const offset = date_.getTimezoneOffset();
		if (offset !== 0) {
			const absoluteOffset = Math.abs(offset);
			const hourOffset = addLeadingZeros(Math.trunc(absoluteOffset / 60), 2);
			const minuteOffset = addLeadingZeros(absoluteOffset % 60, 2);
			tzOffset = `${offset < 0 ? "+" : "-"}${hourOffset}:${minuteOffset}`;
		} else tzOffset = "Z";
		const hour = addLeadingZeros(date_.getHours(), 2);
		const minute = addLeadingZeros(date_.getMinutes(), 2);
		const second = addLeadingZeros(date_.getSeconds(), 2);
		const separator = result === "" ? "" : "T";
		const time = [
			hour,
			minute,
			second
		].join(timeDelimiter);
		result = `${result}${separator}${time}${tzOffset}`;
	}
	return result;
}

//#endregion
//#region ../packages/core/src/utils.ts
function generateUUID() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = Math.random() * 16 | 0;
		return (c === "x" ? r : r & 3 | 8).toString(16);
	});
}
function convertToUIMessages(messages) {
	return messages.map((message$1) => ({
		id: message$1.id,
		role: message$1.role,
		parts: message$1.parts,
		metadata: { createdAt: formatISO(message$1.createdAt) }
	}));
}

//#endregion
//#region ../packages/db/src/queries.ts
let _db;
const getOrInitializeDb = async () => {
	if (!isDatabaseAvailable()) throw new Error("Database configuration required. Please set PGDATABASE/PGHOST/PGUSER or POSTGRES_URL environment variables.");
	if (_db) return _db;
	const authMethod = getAuthMethod();
	if (authMethod === "oauth" || authMethod === "cli") console.log(`Using ${getAuthMethodDescription()} authentication for Postgres connection`);
	else if (process.env.POSTGRES_URL) _db = drizzle(src_default$1(process.env.POSTGRES_URL));
	return _db;
};
async function ensureDb() {
	const db = await getOrInitializeDb();
	const authMethod = getAuthMethod();
	if (authMethod === "oauth" || authMethod === "cli") {
		const authDescription = getAuthMethodDescription();
		console.log(`[ensureDb] Getting ${authDescription} database connection...`);
		try {
			const { getDb } = await import("./connection-pool-CaiCDOl7.mjs");
			const database = await getDb();
			console.log(`[ensureDb] ${authDescription} db connection obtained successfully`);
			return database;
		} catch (error) {
			console.error(`[ensureDb] Failed to get ${authDescription} connection:`, error);
			throw error;
		}
	}
	if (!db) {
		console.error("[ensureDb] DB is still null after initialization attempt!");
		throw new Error("Database connection could not be established");
	}
	return db;
}
async function saveChat({ id, userId, title, visibility }) {
	if (!isDatabaseAvailable()) {
		console.log("[saveChat] Database not available, skipping persistence");
		return;
	}
	try {
		return await (await ensureDb()).insert(chat).values({
			id,
			createdAt: /* @__PURE__ */ new Date(),
			userId,
			title,
			visibility
		});
	} catch (error) {
		console.error("[saveChat] Error saving chat:", error);
		throw new ChatSDKError("bad_request:database", "Failed to save chat");
	}
}
async function deleteChatById({ id }) {
	if (!isDatabaseAvailable()) {
		console.log("[deleteChatById] Database not available, skipping deletion");
		return null;
	}
	try {
		await (await ensureDb()).delete(message).where(eq(message.chatId, id));
		const [chatsDeleted] = await (await ensureDb()).delete(chat).where(eq(chat.id, id)).returning();
		return chatsDeleted;
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to delete chat by id");
	}
}
async function getChatsByUserId({ id, limit, startingAfter, endingBefore }) {
	if (!isDatabaseAvailable()) {
		console.log("[getChatsByUserId] Database not available, returning empty");
		return {
			chats: [],
			hasMore: false
		};
	}
	try {
		const extendedLimit = limit + 1;
		const query = async (whereCondition) => {
			return (await ensureDb()).select().from(chat).where(whereCondition ? and(whereCondition, eq(chat.userId, id)) : eq(chat.userId, id)).orderBy(desc(chat.createdAt)).limit(extendedLimit);
		};
		let filteredChats = [];
		if (startingAfter) {
			console.log("[getChatsByUserId] Fetching chat for startingAfter:", startingAfter);
			const [selectedChat] = await (await ensureDb()).select().from(chat).where(eq(chat.id, startingAfter)).limit(1);
			if (!selectedChat) throw new ChatSDKError("not_found:database", `Chat with id ${startingAfter} not found`);
			filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
		} else if (endingBefore) {
			console.log("[getChatsByUserId] Fetching chat for endingBefore:", endingBefore);
			const [selectedChat] = await (await ensureDb()).select().from(chat).where(eq(chat.id, endingBefore)).limit(1);
			if (!selectedChat) throw new ChatSDKError("not_found:database", `Chat with id ${endingBefore} not found`);
			filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
		} else {
			console.log("[getChatsByUserId] Executing main query without pagination");
			filteredChats = await query();
		}
		const hasMore = filteredChats.length > limit;
		console.log("[getChatsByUserId] Query successful, found", filteredChats.length, "chats");
		return {
			chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
			hasMore
		};
	} catch (error) {
		console.error("[getChatsByUserId] Error details:", error);
		console.error("[getChatsByUserId] Error stack:", error instanceof Error ? error.stack : "No stack available");
		throw new ChatSDKError("bad_request:database", "Failed to get chats by user id");
	}
}
async function getChatById({ id }) {
	if (!isDatabaseAvailable()) {
		console.log("[getChatById] Database not available, returning null");
		return null;
	}
	try {
		const [selectedChat] = await (await ensureDb()).select().from(chat).where(eq(chat.id, id));
		if (!selectedChat) return null;
		return selectedChat;
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
	}
}
async function saveMessages({ messages }) {
	if (!isDatabaseAvailable()) {
		console.log("[saveMessages] Database not available, skipping persistence");
		return;
	}
	try {
		return await (await ensureDb()).insert(message).values(messages).onConflictDoUpdate({
			target: message.id,
			set: {
				parts: sql`excluded.parts`,
				attachments: sql`excluded.attachments`,
				traceId: sql`excluded."traceId"`
			}
		});
	} catch (_error) {
		console.error("[saveMessages] DB error:", _error);
		throw new ChatSDKError("bad_request:database", "Failed to save messages");
	}
}
async function getMessagesByChatId({ id }) {
	if (!isDatabaseAvailable()) {
		console.log("[getMessagesByChatId] Database not available, returning empty");
		return [];
	}
	try {
		return await (await ensureDb()).select().from(message).where(eq(message.chatId, id)).orderBy(asc(message.createdAt));
	} catch (_error) {
		console.error("[getMessagesByChatId] Database error:", _error);
		throw new ChatSDKError("bad_request:database", "Failed to get messages by chat id");
	}
}
async function getMessageById({ id }) {
	if (!isDatabaseAvailable()) {
		console.log("[getMessageById] Database not available, returning empty");
		return [];
	}
	try {
		return await (await ensureDb()).select().from(message).where(eq(message.id, id));
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to get message by id");
	}
}
async function deleteMessagesByChatIdAfterTimestamp({ chatId, timestamp }) {
	if (!isDatabaseAvailable()) {
		console.log("[deleteMessagesByChatIdAfterTimestamp] Database not available, skipping deletion");
		return;
	}
	try {
		const messageIds = (await (await ensureDb()).select({ id: message.id }).from(message).where(and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)))).map((message$1) => message$1.id);
		if (messageIds.length > 0) {
			const db = await ensureDb();
			await db.delete(vote).where(inArray(vote.messageId, messageIds));
			return await db.delete(message).where(and(eq(message.chatId, chatId), inArray(message.id, messageIds)));
		}
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to delete messages by chat id after timestamp");
	}
}
async function updateChatVisiblityById({ chatId, visibility }) {
	if (!isDatabaseAvailable()) {
		console.log("[updateChatVisiblityById] Database not available, skipping update");
		return;
	}
	try {
		return await (await ensureDb()).update(chat).set({ visibility }).where(eq(chat.id, chatId));
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to update chat visibility by id");
	}
}
async function updateChatTitleById({ chatId, title }) {
	if (!isDatabaseAvailable()) {
		console.log("[updateChatTitleById] Database not available, skipping update");
		return;
	}
	try {
		return await (await ensureDb()).update(chat).set({ title }).where(eq(chat.id, chatId));
	} catch (_error) {
		throw new ChatSDKError("bad_request:database", "Failed to update chat title by id");
	}
}
async function updateChatLastContextById({ chatId, context }) {
	if (!isDatabaseAvailable()) {
		console.log("[updateChatLastContextById] Database not available, skipping update");
		return;
	}
	try {
		return await (await ensureDb()).update(chat).set({ lastContext: context }).where(eq(chat.id, chatId));
	} catch (error) {
		console.warn("Failed to update lastContext for chat", chatId, error);
		return;
	}
}
async function voteMessage({ chatId, messageId, type }) {
	if (!isDatabaseAvailable()) return;
	await (await ensureDb()).insert(vote).values({
		chatId,
		messageId,
		isUpvoted: type === "up"
	}).onConflictDoUpdate({
		target: [vote.chatId, vote.messageId],
		set: { isUpvoted: type === "up" }
	});
}
async function getVotesByChatId({ id }) {
	if (!isDatabaseAvailable()) return [];
	return (await ensureDb()).select().from(vote).where(eq(vote.chatId, id));
}

//#endregion
//#region ../packages/core/src/chat-acl.ts
/**
* Check if a user can access a chat based on visibility and ownership
*
* @param chatId - The ID of the chat to check access for
* @param userId - The ID of the user requesting access
* @returns ChatAccessResult indicating if access is allowed and why
*/
async function checkChatAccess(chatId, userId) {
	console.log(`checking chat access for chat ID: ${chatId} and user ID: ${userId}`);
	const chat$1 = await getChatById({ id: chatId });
	console.log(`chat: ${JSON.stringify(chat$1)}`);
	if (!chat$1) return {
		allowed: false,
		chat: null,
		reason: "not_found"
	};
	if (chat$1.visibility === "public") return {
		allowed: true,
		chat: chat$1
	};
	if (chat$1.visibility === "private") {
		console.log(`checking chat user ID vs user ID. chat user ID: ${chat$1.userId}, user ID: ${userId}`);
		if (chat$1.userId !== userId) return {
			allowed: false,
			chat: chat$1,
			reason: "forbidden"
		};
	}
	return {
		allowed: true,
		chat: chat$1
	};
}

//#endregion
//#region ../packages/core/src/stream-cache.ts
/**
* In-memory stream cache for resumable streams.
*
* This provides a simple in-memory alternative to Redis for stream resumption.
* Streams are stored with a TTL and automatically cleaned up.
*
* Note: This is not suitable for distributed deployments. For production
* with multiple instances, use Redis or another distributed cache.
*/
var StreamCache = class {
	cache = /* @__PURE__ */ new Map();
	activeStreams = /* @__PURE__ */ new Map();
	TTL_MS = 300 * 1e3;
	cleanupInterval = null;
	constructor() {
		console.log("[StreamCache] constructor");
		this.startCleanup();
	}
	startCleanup() {
		if (this.cleanupInterval) return;
		this.cleanupInterval = setInterval(() => {
			const now = Date.now();
			const expiredKeys = [];
			for (const [streamId, stream] of this.cache.entries()) if (now - stream.lastAccessedAt > this.TTL_MS) expiredKeys.push(streamId);
			for (const streamId of expiredKeys) {
				const stream = this.cache.get(streamId);
				if (stream) {
					this.activeStreams.delete(stream.chatId);
					this.clearStream(streamId);
					console.log(`[StreamCache] Expired stream ${streamId} for chat ${stream.chatId}`);
				}
			}
			if (expiredKeys.length > 0) console.log(`[StreamCache] Cleaned up ${expiredKeys.length} expired streams`);
		}, 60 * 1e3);
	}
	/**
	* Store a stream
	*/
	storeStream({ streamId, chatId, stream }) {
		console.log("[StreamCache] storeStream", streamId, chatId);
		this.activeStreams.set(chatId, streamId);
		const entry = {
			chatId,
			streamId,
			cache: makeCacheableStream({
				source: stream,
				onPush: () => {
					entry.lastAccessedAt = Date.now();
				}
			}),
			createdAt: Date.now(),
			lastAccessedAt: Date.now()
		};
		this.cache.set(streamId, entry);
	}
	/**
	* Get a stream (returns a Node.js Readable stream for direct use with Express)
	*/
	getStream(streamId, { cursor } = {}) {
		const cache = this.cache.get(streamId)?.cache;
		if (!cache) return null;
		return cacheableToReadable(cache, { cursor });
	}
	/**
	* Get the active stream ID for a chat
	*/
	getActiveStreamId(chatId) {
		return this.activeStreams.get(chatId) ?? null;
	}
	/**
	* Clear the active stream for a chat (e.g., when starting a new message)
	*/
	clearActiveStream(chatId) {
		const streamId = this.activeStreams.get(chatId);
		if (streamId) {
			this.activeStreams.delete(chatId);
			console.log(`[StreamCache] Cleared active stream ${streamId} for chat ${chatId}`);
		}
	}
	clearStream(streamId) {
		const stream = this.cache.get(streamId);
		if (stream) {
			stream.cache.close();
			this.cache.delete(streamId);
		}
	}
};
/**
* Turns an arbitrary `ReadableStream<T>` into a cache‑able
* async‑iterable.  All data is stored as T[].
*
* @param source The original readable stream you want to cache.
* @param onPush A callback to be called when a chunk is pushed to the stream.
* @returns An object matching the `CacheableStream` interface.
*/
function makeCacheableStream({ source, onPush }) {
	const chunks = [];
	let done = false;
	const waiters = [];
	const notify = () => {
		const current = [...waiters];
		waiters.length = 0;
		current.forEach((resolve) => resolve());
	};
	(async () => {
		const reader = source.getReader();
		try {
			while (true) {
				const { value, done: srcDone } = await reader.read();
				if (srcDone) break;
				chunks.push(value);
				onPush?.(value);
				notify();
			}
		} catch (err) {
			console.error("CacheableStream source error:", err);
		} finally {
			done = true;
			notify();
			reader.releaseLock();
		}
	})();
	return {
		get chunks() {
			return chunks;
		},
		async *read({ cursor } = {}) {
			let idx = cursor ?? 0;
			while (true) {
				while (idx < chunks.length) yield chunks[idx++];
				if (done) return;
				await new Promise((resolve) => waiters.push(resolve));
			}
		},
		close() {
			done = true;
			notify();
		}
	};
}
/**
* Turns a `CacheableStream<T>` into a Node.js `Readable` stream
*
* The stream pulls data from the cached async generator (`cache.read()`),
* honors backpressure, and is directly compatible with Express responses.
*
* Optimized for concurrent streams by:
* - Using non-blocking iteration
* - Batching multiple chunks when available
* - Avoiding blocking async/await in read()
*/
function cacheableToReadable(cache, { cursor } = {}) {
	let iterator;
	let pendingRead = null;
	let isReading = false;
	return new Readable({
		highWaterMark: 16 * 1024,
		read() {
			if (isReading) return;
			isReading = true;
			if (!iterator) iterator = cache.read({ cursor });
			const processNext = async () => {
				try {
					while (true) {
						if (!pendingRead) pendingRead = iterator?.next() ?? null;
						if (!pendingRead) break;
						const { value, done } = await pendingRead;
						pendingRead = null;
						if (done) {
							this.push(null);
							break;
						}
						if (!this.push(value)) break;
						pendingRead = iterator?.next() ?? null;
					}
				} catch (err) {
					this.destroy(err);
				} finally {
					isReading = false;
				}
			};
			processNext();
		},
		destroy(error, callback) {
			if (error) console.log("[StreamCache] Stream destroyed with error:", error.message);
			callback(error);
		}
	});
}

//#endregion
//#region ../packages/core/src/schemas/chat.ts
const textPartSchema = z.object({
	type: z.enum(["text"]),
	text: z.string().min(1)
});
const filePartSchema = z.object({
	type: z.enum(["file"]),
	mediaType: z.enum(["image/jpeg", "image/png"]),
	name: z.string().min(1),
	url: z.string().url()
});
const partSchema = z.union([textPartSchema, filePartSchema]);
const previousMessageSchema = z.object({
	id: z.string(),
	role: z.enum([
		"user",
		"assistant",
		"system"
	]),
	parts: z.array(z.any())
});
const postRequestBodySchema = z.object({
	id: z.string().uuid(),
	message: z.object({
		id: z.string().uuid(),
		role: z.enum(["user"]),
		parts: z.array(partSchema)
	}).optional(),
	selectedChatModel: z.string().min(1),
	selectedVisibilityType: z.enum(["public", "private"]),
	previousMessages: z.array(previousMessageSchema).optional()
});

//#endregion
//#region ../packages/core/src/ai/providers.ts
async function getServerProvider() {
	const { getDatabricksServerProvider } = await import("./src-oV3p0Y4-.mjs");
	return getDatabricksServerProvider();
}
let cachedServerProvider = null;
const myProvider = { async languageModel(id) {
	if (!cachedServerProvider) cachedServerProvider = await getServerProvider();
	return await cachedServerProvider.languageModel(id);
} };

//#endregion
//#region src/middleware/auth.ts
/**
* Middleware to authenticate requests and attach session to request object
*/
async function authMiddleware(req, _res, next) {
	try {
		req.session = await getAuthSession({ getRequestHeader: (name) => req.headers[name.toLowerCase()] }) || void 0;
		next();
	} catch (error) {
		console.error("Auth middleware error:", error);
		next(error);
	}
}
/**
* Middleware to require authentication - returns 401 if no session
*/
function requireAuth(req, res, next) {
	if (!req.session?.user) {
		const response = new ChatSDKError("unauthorized:chat").toResponse();
		return res.status(response.status).json(response.json);
	}
	next();
}
async function requireChatAccess(req, res, next) {
	const id = getIdFromRequest(req);
	if (!id) {
		console.error("Chat access middleware error: no chat ID provided", req.params);
		const response = new ChatSDKError("bad_request:api").toResponse();
		return res.status(response.status).json(response.json);
	}
	const { allowed, reason } = await checkChatAccess(id, req.session?.user.id);
	if (!allowed) {
		console.error("Chat access middleware error: user does not have access to chat", reason);
		const response = new ChatSDKError("forbidden:chat", reason).toResponse();
		return res.status(response.status).json(response.json);
	}
	next();
}
const getIdFromRequest = (req) => {
	const { id } = req.params;
	if (!id) return void 0;
	return typeof id === "string" ? id : id[0];
};

//#endregion
//#region src/lib/message-meta-store.ts
/**
* Best-effort in-memory store for message metadata (traceId, chatId).
*
* In ephemeral mode (no DB), this is the sole source of message metadata.
* In DB mode, it acts as a short-term cache to avoid extra DB lookups for
* recently streamed messages. Data is lost on server restart in either case.
*
* Both maps are size-bounded: once full, the oldest entry (by insertion order)
* is evicted before adding a new one. This prevents unbounded memory growth in
* long-running deployments without adding any package dependencies.
*/
const MAX_ENTRIES = 1e4;
function setBounded(map, key, value) {
	if (map.size >= MAX_ENTRIES) {
		const oldest = map.keys().next().value;
		map.delete(oldest);
	}
	map.set(key, value);
}
const store = /* @__PURE__ */ new Map();
const storeMessageMeta = (messageId, chatId, traceId) => setBounded(store, messageId, {
	traceId,
	chatId
});
const getMessageMetadata = (messageId) => store.get(messageId) ?? null;
const assessmentStore = /* @__PURE__ */ new Map();
const storeAssessmentId = (messageId, userId, assessmentId) => setBounded(assessmentStore, `${messageId}:${userId}`, assessmentId);
const getAssessmentId = (messageId, userId) => assessmentStore.get(`${messageId}:${userId}`) ?? null;

//#endregion
//#region src/lib/stream-fallback.ts
/**
* Reads all chunks from a UI message stream, forwarding non-error parts to the
* writer. Returns whether the stream encountered any errors.
*/
async function drainStreamToWriter(uiStream, writer) {
	const reader = uiStream.getReader();
	let receivedTextChunk = false;
	try {
		for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) if (chunk.value.type === "error") {
			if (!receivedTextChunk) {
				console.error("Error before first text chunk, triggering fallback:", chunk.value.errorText);
				return {
					failed: true,
					errorText: chunk.value.errorText
				};
			}
			console.error("Mid-stream error, forwarding to client:", chunk.value.errorText);
			writer.write(chunk.value);
		} else {
			if (!receivedTextChunk && chunk.value.type.startsWith("text-")) receivedTextChunk = true;
			writer.write(chunk.value);
		}
	} catch (readError) {
		if (!receivedTextChunk) {
			console.error("Stream read error before first text chunk:", readError);
			return { failed: true };
		}
		console.error("Mid-stream read error:", readError);
	} finally {
		reader.releaseLock();
	}
	return { failed: false };
}
/**
* Converts a generateText result's content array into UIMessageChunks and
* writes them to the stream writer. This is the non-streaming equivalent of
* streamText's toUIMessageStream: it walks the unified `content` array and
* emits the matching chunk types so the client sees the same parts regardless
* of whether the response was streamed or generated as a whole.
*
* The ContentPart → UIMessageChunk mapping mirrors the transform in the AI SDK's
* streamText().toUIMessageStream() (ai/src/generate-text/stream-text.ts). All
* content part types are handled:
*   text       → text-start / text-delta / text-end
*   reasoning  → reasoning-start / reasoning-delta / reasoning-end
*   file       → file  (data URL, same as the SDK streaming path)
*   source     → source-url | source-document
*   tool-call  → tool-input-available
*   tool-result→ tool-output-available
*   tool-error, tool-approval-request → ignored (not expected in fallback)
*/
function writeGenerateTextResultToStream(result, writer) {
	for (const part of result.content) {
		const id = generateUUID();
		switch (part.type) {
			case "text":
				if (part.text.length > 0) {
					writer.write({
						type: "text-start",
						id
					});
					writer.write({
						type: "text-delta",
						id,
						delta: part.text
					});
					writer.write({
						type: "text-end",
						id
					});
				}
				break;
			case "reasoning":
				if (part.text.length > 0) {
					writer.write({
						type: "reasoning-start",
						id
					});
					writer.write({
						type: "reasoning-delta",
						id,
						delta: part.text
					});
					writer.write({
						type: "reasoning-end",
						id
					});
				}
				break;
			case "file":
				writer.write({
					type: "file",
					mediaType: part.file.mediaType,
					url: `data:${part.file.mediaType};base64,${part.file.base64}`
				});
				break;
			case "source":
				if (part.sourceType === "url") writer.write({
					type: "source-url",
					sourceId: part.id,
					url: part.url,
					title: part.title,
					...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
				});
				else if (part.sourceType === "document") writer.write({
					type: "source-document",
					sourceId: part.id,
					mediaType: part.mediaType,
					title: part.title,
					filename: part.filename,
					...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
				});
				break;
			case "tool-call":
				writer.write({
					type: "tool-input-available",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input,
					dynamic: part.dynamic
				});
				break;
			case "tool-result":
				writer.write({
					type: "tool-output-available",
					toolCallId: part.toolCallId,
					output: part.output
				});
				break;
			default: break;
		}
	}
	writer.write({
		type: "finish",
		finishReason: result.finishReason
	});
}
/**
* Falls back to a non-streaming generateText call and writes the result as
* stream parts via writeGenerateTextResultToStream.
* Returns the usage on success, or undefined if the fallback itself fails.
*/
async function fallbackToGenerateText(params, writer) {
	try {
		const fallback = await generateText(params);
		const traceId = (fallback?.response?.body)?.metadata?.trace_id;
		writeGenerateTextResultToStream(fallback, writer);
		return {
			usage: fallback.usage,
			traceId
		};
	} catch (fallbackError) {
		console.error("[fallbackToGenerateText] generateText fallback also failed:", fallbackError);
		const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
		writer.write({
			type: "data-error",
			data: errorMessage
		});
		return;
	}
}

//#endregion
//#region src/lib/local-repo-store.ts
const STORE_PATH = path.resolve(process.cwd(), ".local", "active-repo.json");
function ensureStoreDir() {
	fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}
function normalizeConfig(raw) {
	return {
		path: raw?.path ?? null,
		name: raw?.name ?? null,
		hasGit: raw?.hasGit ?? false,
		updatedAt: raw?.updatedAt ?? null
	};
}
function getLocalRepoConfig() {
	try {
		if (!fs.existsSync(STORE_PATH)) return normalizeConfig();
		return normalizeConfig(JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")));
	} catch {
		return normalizeConfig();
	}
}
function validateRepoPath(repoPath) {
	const resolved = path.resolve(repoPath);
	if (!fs.statSync(resolved).isDirectory()) throw new Error("Repository path must be a directory");
	const hasGit = fs.existsSync(path.join(resolved, ".git"));
	return {
		path: resolved,
		name: path.basename(resolved),
		hasGit,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
function setLocalRepoConfig(repoPath) {
	const config = validateRepoPath(repoPath);
	ensureStoreDir();
	fs.writeFileSync(STORE_PATH, JSON.stringify(config, null, 2));
	return config;
}
function clearLocalRepoConfig() {
	ensureStoreDir();
	const config = normalizeConfig();
	fs.writeFileSync(STORE_PATH, JSON.stringify(config, null, 2));
	return config;
}

//#endregion
//#region src/routes/chat.ts
function toV3Usage(usage) {
	return {
		inputTokens: {
			total: usage.inputTokens,
			noCache: void 0,
			cacheRead: void 0,
			cacheWrite: void 0
		},
		outputTokens: {
			total: usage.outputTokens,
			text: void 0,
			reasoning: void 0
		}
	};
}
const chatRouter = Router();
const streamCache = new StreamCache();
chatRouter.use(authMiddleware);
/**
* POST /api/chat - Send a message and get streaming response
*
* Note: Works in ephemeral mode when database is disabled.
* Streaming continues normally, but no chat/message persistence occurs.
*/
chatRouter.post("/", requireAuth, async (req, res) => {
	const dbAvailable = isDatabaseAvailable();
	if (!dbAvailable) console.log("[Chat] Running in ephemeral mode - no persistence");
	let requestBody;
	try {
		requestBody = postRequestBodySchema.parse(req.body);
	} catch (_) {
		console.error("Error parsing request body:", _);
		const response = new ChatSDKError("bad_request:api").toResponse();
		return res.status(response.status).json(response.json);
	}
	try {
		const { id, message: message$1, selectedChatModel, selectedVisibilityType } = requestBody;
		const session = req.session;
		if (!session) {
			const response = new ChatSDKError("unauthorized:chat").toResponse();
			return res.status(response.status).json(response.json);
		}
		const { chat: chat$1, allowed, reason } = await checkChatAccess(id, session?.user.id);
		if (reason !== "not_found" && !allowed) {
			const response = new ChatSDKError("forbidden:chat").toResponse();
			return res.status(response.status).json(response.json);
		}
		let titlePromise;
		if (!chat$1) {
			if (isDatabaseAvailable() && message$1) {
				await saveChat({
					id,
					userId: session.user.id,
					title: "New chat",
					visibility: selectedVisibilityType
				});
				titlePromise = generateTitleFromUserMessage({ message: message$1 }).then(async (title) => {
					await updateChatTitleById({
						chatId: id,
						title
					});
					return title;
				}).catch(async (error) => {
					console.error("Error generating title:", error);
					const textFromUserMessage = message$1?.parts.find((part) => part.type === "text")?.text;
					if (textFromUserMessage) {
						const fallback = truncatePreserveWords(textFromUserMessage, 128);
						await updateChatTitleById({
							chatId: id,
							title: fallback
						});
						return fallback;
					}
					return null;
				});
			}
		} else if (chat$1.userId !== session.user.id) {
			const response = new ChatSDKError("forbidden:chat").toResponse();
			return res.status(response.status).json(response.json);
		}
		const messagesFromDb = await getMessagesByChatId({ id });
		const previousMessages = !dbAvailable || !message$1 && requestBody.previousMessages ? requestBody.previousMessages ?? [] : convertToUIMessages(messagesFromDb);
		let uiMessages;
		if (message$1) {
			uiMessages = [...previousMessages, message$1];
			await saveMessages({ messages: [{
				chatId: id,
				id: message$1.id,
				role: "user",
				parts: message$1.parts,
				attachments: [],
				createdAt: /* @__PURE__ */ new Date(),
				traceId: null
			}] });
		} else {
			uiMessages = previousMessages;
			if (dbAvailable && requestBody.previousMessages) {
				const assistantMessages = requestBody.previousMessages.filter((m) => m.role === "assistant");
				if (assistantMessages.length > 0) {
					await saveMessages({ messages: assistantMessages.map((m) => ({
						chatId: id,
						id: m.id,
						role: m.role,
						parts: m.parts,
						attachments: [],
						createdAt: m.metadata?.createdAt ? new Date(m.metadata.createdAt) : /* @__PURE__ */ new Date(),
						traceId: null
					})) });
					if (requestBody.previousMessages?.some((m) => m.parts?.some((p) => p.type === "dynamic-tool" && (p.state === "output-denied" || "approval" in p && p.approval?.approved === false)))) {
						res.end();
						return;
					}
				}
			}
		}
		streamCache.clearActiveStream(id);
		let finalUsage;
		let traceId = null;
		const streamId = generateUUID();
		const model = await myProvider.languageModel(selectedChatModel);
		const modelMessages = await convertToModelMessages(uiMessages);
		const repo = getLocalRepoConfig();
		const requestHeaders = {
			[CONTEXT_HEADER_CONVERSATION_ID]: id,
			[CONTEXT_HEADER_USER_ID]: session.user.email ?? session.user.id,
			...selectedChatModel ? { "x-codex-model-endpoint": selectedChatModel } : {},
			...repo.path ? { "x-codex-workspace-root": repo.path } : {},
			...req.headers["x-forwarded-access-token"] ? { "x-forwarded-access-token": req.headers["x-forwarded-access-token"] } : {}
		};
		const result = streamText({
			model,
			messages: modelMessages,
			providerOptions: { databricks: { includeTrace: true } },
			includeRawChunks: true,
			headers: requestHeaders,
			onChunk: ({ chunk }) => {
				if (chunk.type === "raw") {
					const raw = chunk.rawValue;
					if (raw?.type === "response.output_item.done") {
						const traceIdFromChunk = raw?.databricks_output?.trace?.info?.trace_id;
						if (typeof traceIdFromChunk === "string") traceId = traceIdFromChunk;
					}
					if (!traceId && typeof raw?.trace_id === "string") traceId = raw.trace_id;
				}
			},
			onFinish: ({ usage }) => {
				finalUsage = usage;
			}
		});
		pipeUIMessageStreamToResponse({
			stream: createUIMessageStream({
				originalMessages: uiMessages,
				generateId: generateUUID,
				execute: async ({ writer }) => {
					const { failed } = await drainStreamToWriter(result.toUIMessageStream({
						sendReasoning: true,
						sendSources: true,
						sendFinish: false,
						onError: (error) => {
							const msg = error instanceof Error ? error.message : String(error);
							writer.onError?.(error);
							return msg;
						}
					}), writer);
					if (failed) {
						console.log("Streaming failed, falling back to generateText...");
						const fallbackResult = await fallbackToGenerateText({
							model,
							messages: modelMessages,
							headers: requestHeaders
						}, writer);
						finalUsage = fallbackResult?.usage;
						traceId = fallbackResult?.traceId ?? null;
					}
					if (titlePromise) {
						const generatedTitle = await titlePromise;
						if (generatedTitle) writer.write({
							type: "data-title",
							data: generatedTitle
						});
					}
					writer.write({
						type: "data-traceId",
						data: traceId
					});
				},
				onFinish: async ({ responseMessage }) => {
					storeMessageMeta(responseMessage.id, id, traceId);
					try {
						await saveMessages({ messages: [{
							id: responseMessage.id,
							role: responseMessage.role,
							parts: responseMessage.parts,
							createdAt: /* @__PURE__ */ new Date(),
							attachments: [],
							chatId: id,
							traceId
						}] });
					} catch (err) {
						console.error("[onFinish] Failed to save assistant message:", err);
					}
					if (finalUsage) try {
						await updateChatLastContextById({
							chatId: id,
							context: toV3Usage(finalUsage)
						});
					} catch (err) {
						console.warn("Unable to persist last usage for chat", id, err);
					}
					streamCache.clearActiveStream(id);
				}
			}),
			response: res,
			consumeSseStream({ stream }) {
				streamCache.storeStream({
					streamId,
					chatId: id,
					stream
				});
			}
		});
	} catch (error) {
		console.error("[Chat] Caught error in chat API:", {
			errorType: error?.constructor?.name,
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : void 0,
			error
		});
		if (error instanceof ChatSDKError) {
			const response$1 = error.toResponse();
			return res.status(response$1.status).json(response$1.json);
		}
		const response = new ChatSDKError("offline:chat").toResponse();
		return res.status(response.status).json(response.json);
	}
});
/**
* DELETE /api/chat?id=:id - Delete a chat
*/
chatRouter.delete("/:id", [requireAuth, requireChatAccess], async (req, res) => {
	const id = getIdFromRequest(req);
	if (!id) return;
	const deletedChat = await deleteChatById({ id });
	return res.status(200).json(deletedChat);
});
/**
* GET /api/chat/:id
*/
chatRouter.get("/:id", [requireAuth, requireChatAccess], async (req, res) => {
	const id = getIdFromRequest(req);
	if (!id) return;
	const { chat: chat$1 } = await checkChatAccess(id, req.session?.user.id);
	return res.status(200).json(chat$1);
});
/**
* GET /api/chat/:id/stream - Resume a stream
*/
chatRouter.get("/:id/stream", [requireAuth], async (req, res) => {
	const chatId = getIdFromRequest(req);
	if (!chatId) return;
	const cursor = req.headers["x-resume-stream-cursor"];
	console.log(`[Stream Resume] Cursor: ${cursor}`);
	console.log(`[Stream Resume] GET request for chat ${chatId}`);
	const streamId = streamCache.getActiveStreamId(chatId);
	if (!streamId) {
		console.log(`[Stream Resume] No active stream for chat ${chatId}`);
		const response = new ChatSDKError("empty:stream").toResponse();
		return res.status(response.status).json(response.json);
	}
	const { allowed, reason } = await checkChatAccess(chatId, req.session?.user.id);
	if (reason === "not_found") console.log(`[Stream Resume] Resuming stream for temporary chat ${chatId} (not yet in DB)`);
	else if (!allowed) {
		console.log(`[Stream Resume] User ${req.session?.user.id} does not have access to chat ${chatId} (reason: ${reason})`);
		const response = new ChatSDKError("forbidden:chat", reason).toResponse();
		return res.status(response.status).json(response.json);
	}
	const stream = streamCache.getStream(streamId, { cursor: cursor ? Number.parseInt(cursor) : void 0 });
	if (!stream) {
		console.log(`[Stream Resume] No stream found for ${streamId}`);
		const response = new ChatSDKError("empty:stream").toResponse();
		return res.status(response.status).json(response.json);
	}
	console.log(`[Stream Resume] Resuming stream ${streamId}`);
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	stream.pipe(res);
	stream.on("error", (error) => {
		console.error("[Stream Resume] Stream error:", error);
		if (!res.headersSent) res.status(500).end();
	});
});
/**
* POST /api/chat/title - Generate title from message
*/
chatRouter.post("/title", requireAuth, async (req, res) => {
	try {
		const { message: message$1 } = req.body;
		const title = await generateTitleFromUserMessage({ message: message$1 });
		res.json({ title });
	} catch (error) {
		console.error("Error generating title:", error);
		res.status(500).json({ error: "Failed to generate title" });
	}
});
/**
* PATCH /api/chat/:id/visibility - Update chat visibility
*/
chatRouter.patch("/:id/visibility", [requireAuth, requireChatAccess], async (req, res) => {
	try {
		const id = getIdFromRequest(req);
		if (!id) return;
		const { visibility } = req.body;
		if (!visibility || !["public", "private"].includes(visibility)) return res.status(400).json({ error: "Invalid visibility type" });
		await updateChatVisiblityById({
			chatId: id,
			visibility
		});
		res.json({ success: true });
	} catch (error) {
		console.error("Error updating visibility:", error);
		res.status(500).json({ error: "Failed to update visibility" });
	}
});
async function generateTitleFromUserMessage({ message: message$1, maxMessageLength = 256 }) {
	const model = await myProvider.languageModel("title-model");
	const truncatedMessage = {
		...message$1,
		parts: message$1.parts.map((part) => part.type === "text" ? {
			...part,
			text: part.text.slice(0, maxMessageLength)
		} : part)
	};
	const { text: title } = await generateText({
		model,
		system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons. do not include other expository content ("I'll help...")`,
		prompt: JSON.stringify(truncatedMessage)
	});
	return title;
}
function truncatePreserveWords(input, maxLength) {
	if (maxLength <= 0) return "";
	if (input.length <= maxLength) return input;
	const slice = input.slice(0, maxLength);
	const lastSpaceIndex = slice.lastIndexOf(" ");
	if (lastSpaceIndex === -1) return slice;
	if (lastSpaceIndex === 0) return slice;
	return slice.slice(0, lastSpaceIndex);
}

//#endregion
//#region src/routes/history.ts
const historyRouter = Router();
historyRouter.use(authMiddleware);
/**
* GET /api/history - Get chat history for authenticated user
*/
historyRouter.get("/", requireAuth, async (req, res) => {
	console.log("[/api/history] Handler called");
	const dbAvailable = isDatabaseAvailable();
	console.log("[/api/history] Database available:", dbAvailable);
	if (!dbAvailable) {
		console.log("[/api/history] Returning 204 No Content");
		return res.status(204).end();
	}
	const session = req.session;
	if (!session) {
		const response = new ChatSDKError("unauthorized:chat").toResponse();
		return res.status(response.status).json(response.json);
	}
	const limit = Number.parseInt(req.query.limit || "10");
	const startingAfter = req.query.starting_after;
	const endingBefore = req.query.ending_before;
	if (startingAfter && endingBefore) {
		const response = new ChatSDKError("bad_request:api", "Only one of starting_after or ending_before can be provided.").toResponse();
		return res.status(response.status).json(response.json);
	}
	try {
		const chats = await getChatsByUserId({
			id: session.user.id,
			limit,
			startingAfter: startingAfter ?? null,
			endingBefore: endingBefore ?? null
		});
		res.json(chats);
	} catch (error) {
		console.error("[/api/history] Error in handler:", error);
		res.status(500).json({ error: "Failed to fetch chat history" });
	}
});

//#endregion
//#region src/routes/session.ts
const sessionRouter = Router();
sessionRouter.use(authMiddleware);
/**
* GET /api/session - Get current user session
*/
sessionRouter.get("/", async (req, res) => {
	const session = req.session;
	if (!session?.user) return res.json({ user: null });
	const clientSession = { user: {
		email: session.user.email,
		name: session.user.name,
		preferredUsername: session.user.preferredUsername
	} };
	res.json(clientSession);
});

//#endregion
//#region src/routes/messages.ts
const messagesRouter = Router();
messagesRouter.use(authMiddleware);
/**
* GET /api/messages/:id - Get messages by chat ID
*/
messagesRouter.get("/:id", [requireAuth, requireChatAccess], async (req, res) => {
	const id = getIdFromRequest(req);
	if (!id) return;
	try {
		const messages = await getMessagesByChatId({ id });
		return res.status(200).json(messages);
	} catch (error) {
		console.error("Error getting messages by chat ID:", error);
		return res.status(500).json({ error: "Failed to get messages" });
	}
});
/**
* DELETE /api/messages/:id/trailing - Delete trailing messages after a specific message
*/
messagesRouter.delete("/:id/trailing", [requireAuth], async (req, res) => {
	try {
		const dbAvailable = isDatabaseAvailable();
		console.log("[/api/messages/:id/trailing] Database available:", dbAvailable);
		if (!dbAvailable) {
			console.log("[/api/messages/:id/trailing] Returning 204 No Content");
			return res.status(204).end();
		}
		const id = getIdFromRequest(req);
		if (!id) return;
		const [message$1] = await getMessageById({ id });
		if (!message$1) {
			const response = new ChatSDKError("not_found:message").toResponse();
			return res.status(response.status).json(response.json);
		}
		const { allowed, reason } = await checkChatAccess(message$1.chatId, req.session?.user.id);
		if (!allowed) {
			const response = new ChatSDKError("forbidden:chat", reason).toResponse();
			return res.status(response.status).json(response.json);
		}
		await deleteMessagesByChatIdAfterTimestamp({
			chatId: message$1.chatId,
			timestamp: message$1.createdAt
		});
		res.json({ success: true });
	} catch (error) {
		console.error("Error deleting trailing messages:", error);
		res.status(500).json({ error: "Failed to delete messages" });
	}
});

//#endregion
//#region src/lib/local-agent-config.ts
const DEFAULT_AGENT_ROOT$1 = path.resolve(process.cwd(), "..", "agent-langgraph");
function resolveAgentRoot$1() {
	return path.resolve(process.env.LOCAL_AGENT_REPO_ROOT || DEFAULT_AGENT_ROOT$1);
}
function readEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return {};
	const values = {};
	const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || !line.includes("=")) continue;
		const [key, ...rest] = line.split("=");
		values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
	}
	return values;
}
function parseList(raw) {
	if (!raw) return [];
	return raw.split(",").map((value) => value.trim()).filter(Boolean);
}
function getLocalAgentModelConfig() {
	const agentRoot = resolveAgentRoot$1();
	const envValues = {
		...readEnvFile(path.join(agentRoot, ".env.example")),
		...readEnvFile(path.join(agentRoot, ".env"))
	};
	const defaultModel = process.env.LOCAL_AGENT_DEFAULT_MODEL_ENDPOINT || envValues.AGENT_MODEL_ENDPOINT || null;
	return {
		defaultModel,
		availableModels: Array.from(new Set([
			...parseList(process.env.LOCAL_AGENT_MODEL_ENDPOINTS),
			...parseList(envValues.AGENT_AVAILABLE_MODEL_ENDPOINTS),
			defaultModel
		].filter((value) => typeof value === "string" && value.length > 0)))
	};
}

//#endregion
//#region src/lib/shared-profile-store.ts
const DEFAULT_AGENT_ROOT = path.resolve(process.cwd(), "..", "agent-langgraph");
const PROFILE_KINDS = new Set([
	"coding_preference",
	"workstyle_preference",
	"user_fact",
	"constraint"
]);
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function resolveAgentRoot() {
	return path.resolve(process.env.LOCAL_AGENT_REPO_ROOT || DEFAULT_AGENT_ROOT);
}
function resolveGlobalProfilePath() {
	const configured = process.env.USER_PROFILE_PATH;
	if (configured) return path.isAbsolute(configured) ? configured : path.resolve(resolveAgentRoot(), configured);
	return path.resolve(resolveAgentRoot(), ".local", "user_profile.json");
}
function resolveProjectProfileDir() {
	const configured = process.env.PROJECT_PROFILE_DIR;
	if (configured) return path.isAbsolute(configured) ? configured : path.resolve(resolveAgentRoot(), configured);
	return path.resolve(resolveAgentRoot(), ".local", "project_profiles");
}
function sanitizeName(value) {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-_.]+|[-_.]+$/g, "") || "workspace";
}
function resolveProjectProfilePath(workspaceRoot) {
	const resolved = path.resolve(workspaceRoot);
	const digest = crypto.createHash("sha256").update(resolved, "utf8").digest("hex").slice(0, 16);
	return path.join(resolveProjectProfileDir(), `${sanitizeName(path.basename(resolved))}-${digest}.json`);
}
function ensureParent(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
function defaultDocument(scope, workspaceRoot) {
	return {
		scope,
		title: scope === "project" ? `Project profile: ${workspaceRoot ? path.basename(workspaceRoot) : "unknown"}` : "Persistent user profile",
		path: scope === "project" && workspaceRoot ? resolveProjectProfilePath(workspaceRoot) : resolveGlobalProfilePath(),
		workspace_root: workspaceRoot,
		workspace_name: workspaceRoot ? path.basename(workspaceRoot) : null,
		updated_at: nowIso(),
		entries: []
	};
}
function normalizeEntry(raw, timestamp) {
	const kind = (raw.kind || "").trim();
	const content = (raw.content || "").trim();
	const status = (raw.status || "active").trim() || "active";
	if (!PROFILE_KINDS.has(kind) || !content) return null;
	return {
		kind,
		content,
		status,
		confidence: Number(raw.confidence ?? 1),
		created_at: raw.created_at || timestamp,
		updated_at: timestamp
	};
}
function readDocument(scope, workspaceRoot) {
	const filePath = scope === "project" && workspaceRoot ? resolveProjectProfilePath(workspaceRoot) : resolveGlobalProfilePath();
	ensureParent(filePath);
	if (!fs.existsSync(filePath)) {
		const doc = defaultDocument(scope, workspaceRoot);
		fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
		return doc;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		const timestamp = nowIso();
		return {
			...defaultDocument(scope, workspaceRoot),
			...parsed,
			path: filePath,
			scope,
			workspace_root: workspaceRoot,
			workspace_name: workspaceRoot ? path.basename(workspaceRoot) : null,
			updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : timestamp,
			entries: Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeEntry(entry, typeof entry?.updated_at === "string" ? entry.updated_at : timestamp)).filter((entry) => entry !== null) : []
		};
	} catch {
		const doc = defaultDocument(scope, workspaceRoot);
		fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
		return doc;
	}
}
function writeDocument(document) {
	ensureParent(document.path);
	document.updated_at = nowIso();
	fs.writeFileSync(document.path, `${JSON.stringify(document, null, 2)}\n`);
}
function getSharedProfile(scope, workspaceRoot) {
	return readDocument(scope, workspaceRoot);
}
function saveSharedProfile(scope, workspaceRoot, entries) {
	const timestamp = nowIso();
	const document = readDocument(scope, workspaceRoot);
	const activeEntries = entries.map((entry) => normalizeEntry(entry, timestamp)).filter((entry) => entry !== null && entry.status === "active");
	const inactiveEntries = entries.map((entry) => normalizeEntry(entry, timestamp)).filter((entry) => entry !== null && entry.status !== "active");
	document.entries = [...activeEntries, ...inactiveEntries];
	writeDocument(document);
	return document;
}

//#endregion
//#region src/routes/config.ts
const configRouter = Router();
/**
* Extract OAuth scopes from a JWT token (without verification).
* Databricks tokens use 'scope' (space-separated string) or 'scp' (array).
*/
function getScopesFromToken(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return [];
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
		if (typeof payload.scope === "string") return payload.scope.split(" ");
		if (Array.isArray(payload.scp)) return payload.scp;
		return [];
	} catch {
		return [];
	}
}
/**
* GET /api/config - Get application configuration
* Returns feature flags and OBO status based on environment configuration.
* If the user's OBO token is present, decodes it to check which required
* scopes are missing — the banner only shows missing scopes.
*/
configRouter.get("/", async (req, res) => {
	const oboInfo = await getEndpointOboInfo();
	const repo = getLocalRepoConfig();
	const models = getLocalAgentModelConfig();
	let missingScopes = oboInfo.endpointRequiredScopes;
	const userToken = req.headers["x-forwarded-access-token"];
	if (userToken && oboInfo.isEndpointOboEnabled) {
		const tokenScopes = getScopesFromToken(userToken);
		missingScopes = oboInfo.endpointRequiredScopes.filter((required) => {
			const parent = required.split(".")[0];
			return !tokenScopes.some((ts) => ts === required || ts === parent);
		});
	}
	res.json({
		features: {
			chatHistory: isDatabaseAvailable(),
			feedback: !!process.env.MLFLOW_EXPERIMENT_ID
		},
		repo,
		models,
		obo: { missingScopes }
	});
});
configRouter.put("/repo", async (req, res) => {
	const repoPath = req.body?.path;
	if (repoPath === null || repoPath === "") {
		const repo = clearLocalRepoConfig();
		res.json({ repo });
		return;
	}
	if (typeof repoPath !== "string") {
		res.status(400).json({
			code: "bad_request:api",
			cause: "path must be a string"
		});
		return;
	}
	try {
		const repo = setLocalRepoConfig(repoPath);
		res.json({ repo });
	} catch (error) {
		res.status(400).json({
			code: "bad_request:api",
			cause: error instanceof Error ? error.message : String(error)
		});
	}
});
configRouter.get("/profile", async (req, res) => {
	const scope = req.query.scope === "project" ? "project" : "global";
	const repo = getLocalRepoConfig();
	if (scope === "project" && !repo.path) {
		res.json({
			scope,
			title: "Project profile",
			path: null,
			workspace_root: null,
			workspace_name: null,
			updated_at: null,
			entries: []
		});
		return;
	}
	const profile = getSharedProfile(scope, scope === "project" ? repo.path : null);
	res.json(profile);
});
configRouter.put("/profile", async (req, res) => {
	const scope = req.body?.scope === "project" ? "project" : "global";
	const entries = req.body?.entries;
	const repo = getLocalRepoConfig();
	if (!Array.isArray(entries)) {
		res.status(400).json({
			code: "bad_request:api",
			cause: "entries must be an array"
		});
		return;
	}
	if (scope === "project" && !repo.path) {
		res.status(400).json({
			code: "bad_request:api",
			cause: "Select a repository before editing the project profile"
		});
		return;
	}
	const profile = saveSharedProfile(scope, scope === "project" ? repo.path : null, entries);
	res.json(profile);
});

//#endregion
//#region src/routes/feedback.ts
const feedbackRouter = Router();
feedbackRouter.use(authMiddleware);
/**
* POST /api/feedback - Submit feedback for a message
*
* Body:
* - messageId: string - The ID of the message to provide feedback for
* - feedbackType: 'thumbs_up' | 'thumbs_down' - The type of feedback
*/
feedbackRouter.post("/", requireAuth, async (req, res) => {
	try {
		const { messageId, feedbackType } = req.body;
		if (!messageId || !feedbackType) {
			const response = new ChatSDKError("bad_request:api").toResponse();
			return res.status(response.status).json(response.json);
		}
		if (feedbackType !== "thumbs_up" && feedbackType !== "thumbs_down") {
			const response = new ChatSDKError("bad_request:api").toResponse();
			return res.status(response.status).json(response.json);
		}
		const session = req.session;
		if (!session) {
			const response = new ChatSDKError("unauthorized:chat").toResponse();
			return res.status(response.status).json(response.json);
		}
		const messages = await getMessageById({ id: messageId });
		let traceId;
		let chatId;
		if (!messages || messages.length === 0) {
			const metadata = getMessageMetadata(messageId);
			if (!metadata) {
				const response = new ChatSDKError("not_found:database").toResponse();
				return res.status(response.status).json(response.json);
			}
			traceId = metadata.traceId;
			chatId = metadata.chatId;
		} else {
			const dbMessage = messages[0];
			traceId = dbMessage.traceId;
			chatId = dbMessage.chatId;
		}
		let mlflowAssessmentId;
		if (traceId) try {
			const token = await getDatabricksToken();
			const hostUrl = await getWorkspaceHostname();
			const userId = session.user.email ?? session.user.id;
			const existingAssessmentId = getAssessmentId(messageId, session.user.id);
			let mlflowResponse;
			if (existingAssessmentId) mlflowResponse = await fetch(`${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments/${existingAssessmentId}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					assessment: {
						trace_id: traceId,
						assessment_name: "user_feedback",
						feedback: { value: feedbackType === "thumbs_up" }
					},
					update_mask: "feedback"
				})
			});
			else mlflowResponse = await fetch(`${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ assessment: {
					trace_id: traceId,
					assessment_name: "user_feedback",
					source: {
						source_type: "HUMAN",
						source_id: userId
					},
					feedback: { value: feedbackType === "thumbs_up" }
				} })
			});
			if (!mlflowResponse.ok) {
				const errorText = await mlflowResponse.text();
				console.error("Failed to submit feedback to MLflow:", errorText);
				return res.status(mlflowResponse.status).json({ error: "Failed to submit feedback" });
			}
			mlflowAssessmentId = (await mlflowResponse.json()).assessment?.assessment_id;
			if (mlflowAssessmentId) storeAssessmentId(messageId, session.user.id, mlflowAssessmentId);
		} catch (error) {
			console.error("Error submitting feedback to MLflow:", error);
			const chatResponse = new ChatSDKError("offline:chat").toResponse();
			return res.status(chatResponse.status).json(chatResponse.json);
		}
		else console.warn("Message does not have a trace ID, skipping MLflow submission");
		if (chatId) try {
			await voteMessage({
				chatId,
				messageId,
				type: feedbackType === "thumbs_up" ? "up" : "down"
			});
		} catch (err) {
			console.warn("[Feedback] DB vote save failed:", err);
		}
		return res.status(200).json({
			success: true,
			mlflowAssessmentId
		});
	} catch (error) {
		console.error("[Feedback] Error submitting feedback:", error);
		if (error instanceof ChatSDKError) {
			const response$1 = error.toResponse();
			return res.status(response$1.status).json(response$1.json);
		}
		const response = new ChatSDKError("offline:chat").toResponse();
		return res.status(response.status).json(response.json);
	}
});
/**
* GET /api/feedback/chat/:chatId - Get all feedback for a chat
*
* Reads votes from the DB for fast single-query page load.
* Returns a map of messageId -> feedback.
* Returns empty map if DB is unavailable (graceful degradation).
*/
feedbackRouter.get("/chat/:chatId", requireAuth, async (req, res) => {
	try {
		const { chatId } = req.params;
		const session = req.session;
		if (!session) return res.status(200).json({});
		const { allowed, reason } = await checkChatAccess(chatId, session.user.id);
		if (reason !== "not_found" && !allowed) return res.status(200).json({});
		const dbVotes = await getVotesByChatId({ id: chatId });
		const feedbackMap = {};
		for (const v of dbVotes) feedbackMap[v.messageId] = {
			messageId: v.messageId,
			feedbackType: v.isUpvoted ? "thumbs_up" : "thumbs_down",
			assessmentId: null
		};
		return res.status(200).json(feedbackMap);
	} catch (error) {
		console.error("[Feedback] Error getting feedback by chat:", error);
		if (error instanceof ChatSDKError) {
			const response$1 = error.toResponse();
			return res.status(response$1.status).json(response$1.json);
		}
		const response = new ChatSDKError("offline:chat").toResponse();
		return res.status(response.status).json(response.json);
	}
});

//#endregion
//#region src/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const isDevelopment = process.env.NODE_ENV !== "production";
const PORT = process.env.CHAT_APP_PORT || process.env.PORT || (isDevelopment ? 3001 : 3e3);
app.use(cors({
	origin: isDevelopment ? "http://localhost:3000" : true,
	credentials: true
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.get("/ping", (_req, res) => {
	res.status(200).send("pong");
});
app.use("/api/chat", chatRouter);
app.use("/api/history", historyRouter);
app.use("/api/session", sessionRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/config", configRouter);
app.use("/api/feedback", feedbackRouter);
const agentBackendUrl = process.env.API_PROXY;
if (agentBackendUrl) {
	console.log(`✅ Proxying /invocations to ${agentBackendUrl}`);
	app.all("/invocations", async (req, res) => {
		try {
			const forwardHeaders = { ...req.headers };
			forwardHeaders["content-length"] = void 0;
			const response = await fetch(agentBackendUrl, {
				method: req.method,
				headers: forwardHeaders,
				body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : void 0
			});
			res.status(response.status);
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});
			if (response.body) {
				const reader = response.body.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					res.write(value);
				}
			}
			res.end();
		} catch (error) {
			console.error("[/invocations proxy] Error:", error);
			res.status(502).json({
				error: "Proxy error",
				message: error instanceof Error ? error.message : String(error)
			});
		}
	});
}
if (!isDevelopment) {
	const clientBuildPath = path.join(__dirname, "../../client/dist");
	app.use(express.static(clientBuildPath));
	app.get(/^\/(?!api).*/, (_req, res) => {
		res.sendFile(path.join(clientBuildPath, "index.html"));
	});
}
app.use((err, _req, res, _next) => {
	console.error("Error:", err);
	if (err instanceof ChatSDKError) {
		const response = err.toResponse();
		return res.status(response.status).json(response.json);
	}
	res.status(500).json({
		error: "Internal Server Error",
		message: isDevelopment ? err.message : "An unexpected error occurred"
	});
});
async function startServer() {
	if (process.env.PLAYWRIGHT === "True") {
		console.log("[Test Mode] Starting MSW mock server for API mocking...");
		try {
			const modulePath = path.join(dirname(dirname(__dirname)), "tests", "api-mocking", "api-mock-server.ts");
			console.log("[Test Mode] Attempting to load MSW from:", modulePath);
			const { mockServer } = await import(modulePath);
			mockServer.listen({ onUnhandledRequest: (request) => {
				console.warn(`[MSW] Unhandled ${request.method} request to ${request.url}`);
			} });
			console.log("[Test Mode] MSW mock server started successfully");
			console.log("[Test Mode] Registered handlers:", mockServer.listHandlers().length);
			const { getCapturedRequests, resetCapturedRequests, getLastCapturedRequest, resetMlflowAssessmentStore, getLastServingRequestHeaders } = await import(path.join(dirname(dirname(__dirname)), "tests", "api-mocking", "api-mock-handlers.ts"));
			app.get("/api/test/captured-requests", (_req, res) => {
				res.json(getCapturedRequests());
			});
			app.get("/api/test/last-captured-request", (_req, res) => {
				const lastRequest = getLastCapturedRequest();
				if (lastRequest) res.json(lastRequest);
				else res.status(404).json({ error: "No captured requests" });
			});
			app.post("/api/test/reset-captured-requests", (_req, res) => {
				resetCapturedRequests();
				res.json({ success: true });
			});
			app.post("/api/test/reset-mlflow-store", (_req, res) => {
				resetMlflowAssessmentStore();
				res.json({ success: true });
			});
			app.get("/api/test/serving-request-headers", (_req, res) => {
				res.json(getLastServingRequestHeaders());
			});
			console.log("[Test Mode] Test endpoints for context injection registered");
		} catch (error) {
			console.error("[Test Mode] Failed to start MSW:", error);
			console.error("[Test Mode] Error details:", error instanceof Error ? error.stack : error);
		}
		app.post("/api/test/store-message-meta", (req, res) => {
			const { messageId, chatId, traceId } = req.body;
			storeMessageMeta(messageId, chatId, traceId ?? null);
			res.json({ success: true });
		});
	}
	app.listen(PORT, () => {
		console.log(`Backend server is running on http://localhost:${PORT}`);
		console.log(`Environment: ${isDevelopment ? "development" : "production"}`);
	});
}
startServer();
var src_default = app;

//#endregion
export { src_default as default };