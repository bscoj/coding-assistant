import { r as getHostUrl } from "./src-BaHhVWSg.mjs";
import { i as getCachedCliHost, o as getDatabricksToken, s as getDatabricksUserIdentity, t as getAuthMethod } from "./src-CPjp9fdI.mjs";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import * as z4 from "zod/v4";
import { z } from "zod/v4";
import { ZodFirstPartyTypeKind } from "zod/v3";
import { randomUUID } from "node:crypto";

//#region ../node_modules/@ai-sdk/provider/dist/index.mjs
var marker$1 = "vercel.ai.error";
var symbol$1 = Symbol.for(marker$1);
var _a, _b;
var AISDKError = class _AISDKError extends (_b = Error, _a = symbol$1, _b) {
	/**
	* Creates an AI SDK Error.
	*
	* @param {Object} params - The parameters for creating the error.
	* @param {string} params.name - The name of the error.
	* @param {string} params.message - The error message.
	* @param {unknown} [params.cause] - The underlying cause of the error.
	*/
	constructor({ name: name14, message, cause }) {
		super(message);
		this[_a] = true;
		this.name = name14;
		this.cause = cause;
	}
	/**
	* Checks if the given error is an AI SDK Error.
	* @param {unknown} error - The error to check.
	* @returns {boolean} True if the error is an AI SDK Error, false otherwise.
	*/
	static isInstance(error) {
		return _AISDKError.hasMarker(error, marker$1);
	}
	static hasMarker(error, marker15) {
		const markerSymbol = Symbol.for(marker15);
		return error != null && typeof error === "object" && markerSymbol in error && typeof error[markerSymbol] === "boolean" && error[markerSymbol] === true;
	}
};
var name$1 = "AI_APICallError";
var marker2 = `vercel.ai.error.${name$1}`;
var symbol2 = Symbol.for(marker2);
var _a2, _b2;
var APICallError = class extends (_b2 = AISDKError, _a2 = symbol2, _b2) {
	constructor({ message, url, requestBodyValues, statusCode, responseHeaders, responseBody, cause, isRetryable = statusCode != null && (statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500), data }) {
		super({
			name: name$1,
			message,
			cause
		});
		this[_a2] = true;
		this.url = url;
		this.requestBodyValues = requestBodyValues;
		this.statusCode = statusCode;
		this.responseHeaders = responseHeaders;
		this.responseBody = responseBody;
		this.isRetryable = isRetryable;
		this.data = data;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker2);
	}
};
var name2 = "AI_EmptyResponseBodyError";
var marker3 = `vercel.ai.error.${name2}`;
var symbol3 = Symbol.for(marker3);
var _a3, _b3;
var EmptyResponseBodyError = class extends (_b3 = AISDKError, _a3 = symbol3, _b3) {
	constructor({ message = "Empty response body" } = {}) {
		super({
			name: name2,
			message
		});
		this[_a3] = true;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker3);
	}
};
function getErrorMessage(error) {
	if (error == null) return "unknown error";
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	return JSON.stringify(error);
}
var name3 = "AI_InvalidArgumentError";
var marker4 = `vercel.ai.error.${name3}`;
var symbol4 = Symbol.for(marker4);
var _a4, _b4;
var InvalidArgumentError = class extends (_b4 = AISDKError, _a4 = symbol4, _b4) {
	constructor({ message, cause, argument }) {
		super({
			name: name3,
			message,
			cause
		});
		this[_a4] = true;
		this.argument = argument;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker4);
	}
};
var name4 = "AI_InvalidPromptError";
var marker5 = `vercel.ai.error.${name4}`;
var symbol5 = Symbol.for(marker5);
var name5 = "AI_InvalidResponseDataError";
var marker6 = `vercel.ai.error.${name5}`;
var symbol6 = Symbol.for(marker6);
var name6 = "AI_JSONParseError";
var marker7 = `vercel.ai.error.${name6}`;
var symbol7 = Symbol.for(marker7);
var _a7, _b7;
var JSONParseError = class extends (_b7 = AISDKError, _a7 = symbol7, _b7) {
	constructor({ text, cause }) {
		super({
			name: name6,
			message: `JSON parsing failed: Text: ${text}.
Error message: ${getErrorMessage(cause)}`,
			cause
		});
		this[_a7] = true;
		this.text = text;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker7);
	}
};
var name7 = "AI_LoadAPIKeyError";
var marker8 = `vercel.ai.error.${name7}`;
var symbol8 = Symbol.for(marker8);
var name8 = "AI_LoadSettingError";
var marker9 = `vercel.ai.error.${name8}`;
var symbol9 = Symbol.for(marker9);
var name9 = "AI_NoContentGeneratedError";
var marker10 = `vercel.ai.error.${name9}`;
var symbol10 = Symbol.for(marker10);
var name10 = "AI_NoSuchModelError";
var marker11 = `vercel.ai.error.${name10}`;
var symbol11 = Symbol.for(marker11);
var name11 = "AI_TooManyEmbeddingValuesForCallError";
var marker12 = `vercel.ai.error.${name11}`;
var symbol12 = Symbol.for(marker12);
var name12 = "AI_TypeValidationError";
var marker13 = `vercel.ai.error.${name12}`;
var symbol13 = Symbol.for(marker13);
var _a13, _b13;
var TypeValidationError = class _TypeValidationError extends (_b13 = AISDKError, _a13 = symbol13, _b13) {
	constructor({ value, cause, context }) {
		let contextPrefix = "Type validation failed";
		if (context == null ? void 0 : context.field) contextPrefix += ` for ${context.field}`;
		if ((context == null ? void 0 : context.entityName) || (context == null ? void 0 : context.entityId)) {
			contextPrefix += " (";
			const parts = [];
			if (context.entityName) parts.push(context.entityName);
			if (context.entityId) parts.push(`id: "${context.entityId}"`);
			contextPrefix += parts.join(", ");
			contextPrefix += ")";
		}
		super({
			name: name12,
			message: `${contextPrefix}: Value: ${JSON.stringify(value)}.
Error message: ${getErrorMessage(cause)}`,
			cause
		});
		this[_a13] = true;
		this.value = value;
		this.context = context;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker13);
	}
	/**
	* Wraps an error into a TypeValidationError.
	* If the cause is already a TypeValidationError with the same value and context, it returns the cause.
	* Otherwise, it creates a new TypeValidationError.
	*
	* @param {Object} params - The parameters for wrapping the error.
	* @param {unknown} params.value - The value that failed validation.
	* @param {unknown} params.cause - The original error or cause of the validation failure.
	* @param {TypeValidationContext} params.context - Optional context about what is being validated.
	* @returns {TypeValidationError} A TypeValidationError instance.
	*/
	static wrap({ value, cause, context }) {
		var _a15, _b15, _c;
		if (_TypeValidationError.isInstance(cause) && cause.value === value && ((_a15 = cause.context) == null ? void 0 : _a15.field) === (context == null ? void 0 : context.field) && ((_b15 = cause.context) == null ? void 0 : _b15.entityName) === (context == null ? void 0 : context.entityName) && ((_c = cause.context) == null ? void 0 : _c.entityId) === (context == null ? void 0 : context.entityId)) return cause;
		return new _TypeValidationError({
			value,
			cause,
			context
		});
	}
};
var name13 = "AI_UnsupportedFunctionalityError";
var marker14 = `vercel.ai.error.${name13}`;
var symbol14 = Symbol.for(marker14);
var _a14, _b14;
var UnsupportedFunctionalityError = class extends (_b14 = AISDKError, _a14 = symbol14, _b14) {
	constructor({ functionality, message = `'${functionality}' functionality not supported.` }) {
		super({
			name: name13,
			message
		});
		this[_a14] = true;
		this.functionality = functionality;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker14);
	}
};

//#endregion
//#region ../node_modules/eventsource-parser/dist/index.js
var ParseError = class extends Error {
	constructor(message, options) {
		super(message), this.name = "ParseError", this.type = options.type, this.field = options.field, this.value = options.value, this.line = options.line;
	}
};
function noop(_arg) {}
function createParser(callbacks) {
	if (typeof callbacks == "function") throw new TypeError("`callbacks` must be an object, got a function instead. Did you mean `{onEvent: fn}`?");
	const { onEvent = noop, onError = noop, onRetry = noop, onComment } = callbacks;
	let incompleteLine = "", isFirstChunk = !0, id, data = "", eventType = "";
	function feed(newChunk) {
		const chunk = isFirstChunk ? newChunk.replace(/^\xEF\xBB\xBF/, "") : newChunk, [complete, incomplete] = splitLines(`${incompleteLine}${chunk}`);
		for (const line of complete) parseLine(line);
		incompleteLine = incomplete, isFirstChunk = !1;
	}
	function parseLine(line) {
		if (line === "") {
			dispatchEvent();
			return;
		}
		if (line.startsWith(":")) {
			onComment && onComment(line.slice(line.startsWith(": ") ? 2 : 1));
			return;
		}
		const fieldSeparatorIndex = line.indexOf(":");
		if (fieldSeparatorIndex !== -1) {
			const field = line.slice(0, fieldSeparatorIndex), offset = line[fieldSeparatorIndex + 1] === " " ? 2 : 1;
			processField(field, line.slice(fieldSeparatorIndex + offset), line);
			return;
		}
		processField(line, "", line);
	}
	function processField(field, value, line) {
		switch (field) {
			case "event":
				eventType = value;
				break;
			case "data":
				data = `${data}${value}
`;
				break;
			case "id":
				id = value.includes("\0") ? void 0 : value;
				break;
			case "retry":
				/^\d+$/.test(value) ? onRetry(parseInt(value, 10)) : onError(new ParseError(`Invalid \`retry\` value: "${value}"`, {
					type: "invalid-retry",
					value,
					line
				}));
				break;
			default:
				onError(new ParseError(`Unknown field "${field.length > 20 ? `${field.slice(0, 20)}\u2026` : field}"`, {
					type: "unknown-field",
					field,
					value,
					line
				}));
				break;
		}
	}
	function dispatchEvent() {
		data.length > 0 && onEvent({
			id,
			event: eventType || void 0,
			data: data.endsWith(`
`) ? data.slice(0, -1) : data
		}), id = void 0, data = "", eventType = "";
	}
	function reset(options = {}) {
		incompleteLine && options.consume && parseLine(incompleteLine), isFirstChunk = !0, id = void 0, data = "", eventType = "", incompleteLine = "";
	}
	return {
		feed,
		reset
	};
}
function splitLines(chunk) {
	const lines = [];
	let incompleteLine = "", searchIndex = 0;
	for (; searchIndex < chunk.length;) {
		const crIndex = chunk.indexOf("\r", searchIndex), lfIndex = chunk.indexOf(`
`, searchIndex);
		let lineEnd = -1;
		if (crIndex !== -1 && lfIndex !== -1 ? lineEnd = Math.min(crIndex, lfIndex) : crIndex !== -1 ? crIndex === chunk.length - 1 ? lineEnd = -1 : lineEnd = crIndex : lfIndex !== -1 && (lineEnd = lfIndex), lineEnd === -1) {
			incompleteLine = chunk.slice(searchIndex);
			break;
		} else {
			const line = chunk.slice(searchIndex, lineEnd);
			lines.push(line), searchIndex = lineEnd + 1, chunk[searchIndex - 1] === "\r" && chunk[searchIndex] === `
` && searchIndex++;
		}
	}
	return [lines, incompleteLine];
}

//#endregion
//#region ../node_modules/eventsource-parser/dist/stream.js
var EventSourceParserStream = class extends TransformStream {
	constructor({ onError, onRetry, onComment } = {}) {
		let parser;
		super({
			start(controller) {
				parser = createParser({
					onEvent: (event) => {
						controller.enqueue(event);
					},
					onError(error) {
						onError === "terminate" ? controller.error(error) : typeof onError == "function" && onError(error);
					},
					onRetry,
					onComment
				});
			},
			transform(chunk) {
				parser.feed(chunk);
			}
		});
	}
};

//#endregion
//#region ../node_modules/@ai-sdk/provider-utils/dist/index.mjs
function combineHeaders(...headers) {
	return headers.reduce((combinedHeaders, currentHeaders) => ({
		...combinedHeaders,
		...currentHeaders != null ? currentHeaders : {}
	}), {});
}
function extractResponseHeaders(response) {
	return Object.fromEntries([...response.headers]);
}
var { btoa, atob } = globalThis;
var name = "AI_DownloadError";
var marker = `vercel.ai.error.${name}`;
var symbol = Symbol.for(marker);
var createIdGenerator = ({ prefix, size = 16, alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", separator = "-" } = {}) => {
	const generator = () => {
		const alphabetLength = alphabet.length;
		const chars = new Array(size);
		for (let i = 0; i < size; i++) chars[i] = alphabet[Math.random() * alphabetLength | 0];
		return chars.join("");
	};
	if (prefix == null) return generator;
	if (alphabet.includes(separator)) throw new InvalidArgumentError({
		argument: "separator",
		message: `The separator "${separator}" must not be part of the alphabet "${alphabet}".`
	});
	return () => `${prefix}${separator}${generator()}`;
};
var generateId = createIdGenerator();
function isAbortError(error) {
	return (error instanceof Error || error instanceof DOMException) && (error.name === "AbortError" || error.name === "ResponseAborted" || error.name === "TimeoutError");
}
var FETCH_FAILED_ERROR_MESSAGES = ["fetch failed", "failed to fetch"];
var BUN_ERROR_CODES = [
	"ConnectionRefused",
	"ConnectionClosed",
	"FailedToOpenSocket",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE"
];
function isBunNetworkError(error) {
	if (!(error instanceof Error)) return false;
	const code = error.code;
	if (typeof code === "string" && BUN_ERROR_CODES.includes(code)) return true;
	return false;
}
function handleFetchError({ error, url, requestBodyValues }) {
	if (isAbortError(error)) return error;
	if (error instanceof TypeError && FETCH_FAILED_ERROR_MESSAGES.includes(error.message.toLowerCase())) {
		const cause = error.cause;
		if (cause != null) return new APICallError({
			message: `Cannot connect to API: ${cause.message}`,
			cause,
			url,
			requestBodyValues,
			isRetryable: true
		});
	}
	if (isBunNetworkError(error)) return new APICallError({
		message: `Cannot connect to API: ${error.message}`,
		cause: error,
		url,
		requestBodyValues,
		isRetryable: true
	});
	return error;
}
function getRuntimeEnvironmentUserAgent(globalThisAny = globalThis) {
	var _a2$1, _b2$1, _c;
	if (globalThisAny.window) return `runtime/browser`;
	if ((_a2$1 = globalThisAny.navigator) == null ? void 0 : _a2$1.userAgent) return `runtime/${globalThisAny.navigator.userAgent.toLowerCase()}`;
	if ((_c = (_b2$1 = globalThisAny.process) == null ? void 0 : _b2$1.versions) == null ? void 0 : _c.node) return `runtime/node.js/${globalThisAny.process.version.substring(0)}`;
	if (globalThisAny.EdgeRuntime) return `runtime/vercel-edge`;
	return "runtime/unknown";
}
function normalizeHeaders(headers) {
	if (headers == null) return {};
	const normalized = {};
	if (headers instanceof Headers) headers.forEach((value, key) => {
		normalized[key.toLowerCase()] = value;
	});
	else {
		if (!Array.isArray(headers)) headers = Object.entries(headers);
		for (const [key, value] of headers) if (value != null) normalized[key.toLowerCase()] = value;
	}
	return normalized;
}
function withUserAgentSuffix(headers, ...userAgentSuffixParts) {
	const normalizedHeaders = new Headers(normalizeHeaders(headers));
	const currentUserAgentHeader = normalizedHeaders.get("user-agent") || "";
	normalizedHeaders.set("user-agent", [currentUserAgentHeader, ...userAgentSuffixParts].filter(Boolean).join(" "));
	return Object.fromEntries(normalizedHeaders.entries());
}
var VERSION = "4.0.11";
var suspectProtoRx = /"__proto__"\s*:/;
var suspectConstructorRx = /"constructor"\s*:/;
function _parse(text) {
	const obj = JSON.parse(text);
	if (obj === null || typeof obj !== "object") return obj;
	if (suspectProtoRx.test(text) === false && suspectConstructorRx.test(text) === false) return obj;
	return filter(obj);
}
function filter(obj) {
	let next = [obj];
	while (next.length) {
		const nodes = next;
		next = [];
		for (const node of nodes) {
			if (Object.prototype.hasOwnProperty.call(node, "__proto__")) throw new SyntaxError("Object contains forbidden prototype property");
			if (Object.prototype.hasOwnProperty.call(node, "constructor") && Object.prototype.hasOwnProperty.call(node.constructor, "prototype")) throw new SyntaxError("Object contains forbidden prototype property");
			for (const key in node) {
				const value = node[key];
				if (value && typeof value === "object") next.push(value);
			}
		}
	}
	return obj;
}
function secureJsonParse(text) {
	const { stackTraceLimit } = Error;
	try {
		Error.stackTraceLimit = 0;
	} catch (e) {
		return _parse(text);
	}
	try {
		return _parse(text);
	} finally {
		Error.stackTraceLimit = stackTraceLimit;
	}
}
function addAdditionalPropertiesToJsonSchema(jsonSchema2) {
	if (jsonSchema2.type === "object" || Array.isArray(jsonSchema2.type) && jsonSchema2.type.includes("object")) {
		jsonSchema2.additionalProperties = false;
		const { properties } = jsonSchema2;
		if (properties != null) for (const key of Object.keys(properties)) properties[key] = visit(properties[key]);
	}
	if (jsonSchema2.items != null) jsonSchema2.items = Array.isArray(jsonSchema2.items) ? jsonSchema2.items.map(visit) : visit(jsonSchema2.items);
	if (jsonSchema2.anyOf != null) jsonSchema2.anyOf = jsonSchema2.anyOf.map(visit);
	if (jsonSchema2.allOf != null) jsonSchema2.allOf = jsonSchema2.allOf.map(visit);
	if (jsonSchema2.oneOf != null) jsonSchema2.oneOf = jsonSchema2.oneOf.map(visit);
	const { definitions } = jsonSchema2;
	if (definitions != null) for (const key of Object.keys(definitions)) definitions[key] = visit(definitions[key]);
	return jsonSchema2;
}
function visit(def) {
	if (typeof def === "boolean") return def;
	return addAdditionalPropertiesToJsonSchema(def);
}
var ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");
var defaultOptions = {
	name: void 0,
	$refStrategy: "root",
	basePath: ["#"],
	effectStrategy: "input",
	pipeStrategy: "all",
	dateStrategy: "format:date-time",
	mapStrategy: "entries",
	removeAdditionalStrategy: "passthrough",
	allowedAdditionalProperties: true,
	rejectedAdditionalProperties: false,
	definitionPath: "definitions",
	strictUnions: false,
	definitions: {},
	errorMessages: false,
	patternStrategy: "escape",
	applyRegexFlags: false,
	emailStrategy: "format:email",
	base64Strategy: "contentEncoding:base64",
	nameStrategy: "ref"
};
var getDefaultOptions = (options) => typeof options === "string" ? {
	...defaultOptions,
	name: options
} : {
	...defaultOptions,
	...options
};
function parseAnyDef() {
	return {};
}
function parseArrayDef(def, refs) {
	var _a2$1, _b2$1, _c;
	const res = { type: "array" };
	if (((_a2$1 = def.type) == null ? void 0 : _a2$1._def) && ((_c = (_b2$1 = def.type) == null ? void 0 : _b2$1._def) == null ? void 0 : _c.typeName) !== ZodFirstPartyTypeKind.ZodAny) res.items = parseDef(def.type._def, {
		...refs,
		currentPath: [...refs.currentPath, "items"]
	});
	if (def.minLength) res.minItems = def.minLength.value;
	if (def.maxLength) res.maxItems = def.maxLength.value;
	if (def.exactLength) {
		res.minItems = def.exactLength.value;
		res.maxItems = def.exactLength.value;
	}
	return res;
}
function parseBigintDef(def) {
	const res = {
		type: "integer",
		format: "int64"
	};
	if (!def.checks) return res;
	for (const check of def.checks) switch (check.kind) {
		case "min":
			if (check.inclusive) res.minimum = check.value;
			else res.exclusiveMinimum = check.value;
			break;
		case "max":
			if (check.inclusive) res.maximum = check.value;
			else res.exclusiveMaximum = check.value;
			break;
		case "multipleOf":
			res.multipleOf = check.value;
			break;
	}
	return res;
}
function parseBooleanDef() {
	return { type: "boolean" };
}
function parseBrandedDef(_def, refs) {
	return parseDef(_def.type._def, refs);
}
var parseCatchDef = (def, refs) => {
	return parseDef(def.innerType._def, refs);
};
function parseDateDef(def, refs, overrideDateStrategy) {
	const strategy = overrideDateStrategy != null ? overrideDateStrategy : refs.dateStrategy;
	if (Array.isArray(strategy)) return { anyOf: strategy.map((item, i) => parseDateDef(def, refs, item)) };
	switch (strategy) {
		case "string":
		case "format:date-time": return {
			type: "string",
			format: "date-time"
		};
		case "format:date": return {
			type: "string",
			format: "date"
		};
		case "integer": return integerDateParser(def);
	}
}
var integerDateParser = (def) => {
	const res = {
		type: "integer",
		format: "unix-time"
	};
	for (const check of def.checks) switch (check.kind) {
		case "min":
			res.minimum = check.value;
			break;
		case "max":
			res.maximum = check.value;
			break;
	}
	return res;
};
function parseDefaultDef(_def, refs) {
	return {
		...parseDef(_def.innerType._def, refs),
		default: _def.defaultValue()
	};
}
function parseEffectsDef(_def, refs) {
	return refs.effectStrategy === "input" ? parseDef(_def.schema._def, refs) : parseAnyDef();
}
function parseEnumDef(def) {
	return {
		type: "string",
		enum: Array.from(def.values)
	};
}
var isJsonSchema7AllOfType = (type) => {
	if ("type" in type && type.type === "string") return false;
	return "allOf" in type;
};
function parseIntersectionDef(def, refs) {
	const allOf = [parseDef(def.left._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"allOf",
			"0"
		]
	}), parseDef(def.right._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"allOf",
			"1"
		]
	})].filter((x) => !!x);
	const mergedAllOf = [];
	allOf.forEach((schema) => {
		if (isJsonSchema7AllOfType(schema)) mergedAllOf.push(...schema.allOf);
		else {
			let nestedSchema = schema;
			if ("additionalProperties" in schema && schema.additionalProperties === false) {
				const { additionalProperties, ...rest } = schema;
				nestedSchema = rest;
			}
			mergedAllOf.push(nestedSchema);
		}
	});
	return mergedAllOf.length ? { allOf: mergedAllOf } : void 0;
}
function parseLiteralDef(def) {
	const parsedType = typeof def.value;
	if (parsedType !== "bigint" && parsedType !== "number" && parsedType !== "boolean" && parsedType !== "string") return { type: Array.isArray(def.value) ? "array" : "object" };
	return {
		type: parsedType === "bigint" ? "integer" : parsedType,
		const: def.value
	};
}
var emojiRegex = void 0;
var zodPatterns = {
	cuid: /^[cC][^\s-]{8,}$/,
	cuid2: /^[0-9a-z]+$/,
	ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
	email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
	emoji: () => {
		if (emojiRegex === void 0) emojiRegex = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
		return emojiRegex;
	},
	uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
	ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
	ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
	ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
	ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
	base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
	base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
	nanoid: /^[a-zA-Z0-9_-]{21}$/,
	jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function parseStringDef(def, refs) {
	const res = { type: "string" };
	if (def.checks) for (const check of def.checks) switch (check.kind) {
		case "min":
			res.minLength = typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value;
			break;
		case "max":
			res.maxLength = typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value;
			break;
		case "email":
			switch (refs.emailStrategy) {
				case "format:email":
					addFormat(res, "email", check.message, refs);
					break;
				case "format:idn-email":
					addFormat(res, "idn-email", check.message, refs);
					break;
				case "pattern:zod":
					addPattern(res, zodPatterns.email, check.message, refs);
					break;
			}
			break;
		case "url":
			addFormat(res, "uri", check.message, refs);
			break;
		case "uuid":
			addFormat(res, "uuid", check.message, refs);
			break;
		case "regex":
			addPattern(res, check.regex, check.message, refs);
			break;
		case "cuid":
			addPattern(res, zodPatterns.cuid, check.message, refs);
			break;
		case "cuid2":
			addPattern(res, zodPatterns.cuid2, check.message, refs);
			break;
		case "startsWith":
			addPattern(res, RegExp(`^${escapeLiteralCheckValue(check.value, refs)}`), check.message, refs);
			break;
		case "endsWith":
			addPattern(res, RegExp(`${escapeLiteralCheckValue(check.value, refs)}$`), check.message, refs);
			break;
		case "datetime":
			addFormat(res, "date-time", check.message, refs);
			break;
		case "date":
			addFormat(res, "date", check.message, refs);
			break;
		case "time":
			addFormat(res, "time", check.message, refs);
			break;
		case "duration":
			addFormat(res, "duration", check.message, refs);
			break;
		case "length":
			res.minLength = typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value;
			res.maxLength = typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value;
			break;
		case "includes":
			addPattern(res, RegExp(escapeLiteralCheckValue(check.value, refs)), check.message, refs);
			break;
		case "ip":
			if (check.version !== "v6") addFormat(res, "ipv4", check.message, refs);
			if (check.version !== "v4") addFormat(res, "ipv6", check.message, refs);
			break;
		case "base64url":
			addPattern(res, zodPatterns.base64url, check.message, refs);
			break;
		case "jwt":
			addPattern(res, zodPatterns.jwt, check.message, refs);
			break;
		case "cidr":
			if (check.version !== "v6") addPattern(res, zodPatterns.ipv4Cidr, check.message, refs);
			if (check.version !== "v4") addPattern(res, zodPatterns.ipv6Cidr, check.message, refs);
			break;
		case "emoji":
			addPattern(res, zodPatterns.emoji(), check.message, refs);
			break;
		case "ulid":
			addPattern(res, zodPatterns.ulid, check.message, refs);
			break;
		case "base64":
			switch (refs.base64Strategy) {
				case "format:binary":
					addFormat(res, "binary", check.message, refs);
					break;
				case "contentEncoding:base64":
					res.contentEncoding = "base64";
					break;
				case "pattern:zod":
					addPattern(res, zodPatterns.base64, check.message, refs);
					break;
			}
			break;
		case "nanoid": addPattern(res, zodPatterns.nanoid, check.message, refs);
		case "toLowerCase":
		case "toUpperCase":
		case "trim": break;
		default:
	}
	return res;
}
function escapeLiteralCheckValue(literal, refs) {
	return refs.patternStrategy === "escape" ? escapeNonAlphaNumeric(literal) : literal;
}
var ALPHA_NUMERIC = /* @__PURE__ */ new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
function escapeNonAlphaNumeric(source) {
	let result = "";
	for (let i = 0; i < source.length; i++) {
		if (!ALPHA_NUMERIC.has(source[i])) result += "\\";
		result += source[i];
	}
	return result;
}
function addFormat(schema, value, message, refs) {
	var _a2$1;
	if (schema.format || ((_a2$1 = schema.anyOf) == null ? void 0 : _a2$1.some((x) => x.format))) {
		if (!schema.anyOf) schema.anyOf = [];
		if (schema.format) {
			schema.anyOf.push({ format: schema.format });
			delete schema.format;
		}
		schema.anyOf.push({
			format: value,
			...message && refs.errorMessages && { errorMessage: { format: message } }
		});
	} else schema.format = value;
}
function addPattern(schema, regex, message, refs) {
	var _a2$1;
	if (schema.pattern || ((_a2$1 = schema.allOf) == null ? void 0 : _a2$1.some((x) => x.pattern))) {
		if (!schema.allOf) schema.allOf = [];
		if (schema.pattern) {
			schema.allOf.push({ pattern: schema.pattern });
			delete schema.pattern;
		}
		schema.allOf.push({
			pattern: stringifyRegExpWithFlags(regex, refs),
			...message && refs.errorMessages && { errorMessage: { pattern: message } }
		});
	} else schema.pattern = stringifyRegExpWithFlags(regex, refs);
}
function stringifyRegExpWithFlags(regex, refs) {
	var _a2$1;
	if (!refs.applyRegexFlags || !regex.flags) return regex.source;
	const flags = {
		i: regex.flags.includes("i"),
		m: regex.flags.includes("m"),
		s: regex.flags.includes("s")
	};
	const source = flags.i ? regex.source.toLowerCase() : regex.source;
	let pattern = "";
	let isEscaped = false;
	let inCharGroup = false;
	let inCharRange = false;
	for (let i = 0; i < source.length; i++) {
		if (isEscaped) {
			pattern += source[i];
			isEscaped = false;
			continue;
		}
		if (flags.i) {
			if (inCharGroup) {
				if (source[i].match(/[a-z]/)) {
					if (inCharRange) {
						pattern += source[i];
						pattern += `${source[i - 2]}-${source[i]}`.toUpperCase();
						inCharRange = false;
					} else if (source[i + 1] === "-" && ((_a2$1 = source[i + 2]) == null ? void 0 : _a2$1.match(/[a-z]/))) {
						pattern += source[i];
						inCharRange = true;
					} else pattern += `${source[i]}${source[i].toUpperCase()}`;
					continue;
				}
			} else if (source[i].match(/[a-z]/)) {
				pattern += `[${source[i]}${source[i].toUpperCase()}]`;
				continue;
			}
		}
		if (flags.m) {
			if (source[i] === "^") {
				pattern += `(^|(?<=[\r
]))`;
				continue;
			} else if (source[i] === "$") {
				pattern += `($|(?=[\r
]))`;
				continue;
			}
		}
		if (flags.s && source[i] === ".") {
			pattern += inCharGroup ? `${source[i]}\r
` : `[${source[i]}\r
]`;
			continue;
		}
		pattern += source[i];
		if (source[i] === "\\") isEscaped = true;
		else if (inCharGroup && source[i] === "]") inCharGroup = false;
		else if (!inCharGroup && source[i] === "[") inCharGroup = true;
	}
	try {
		new RegExp(pattern);
	} catch (e) {
		console.warn(`Could not convert regex pattern at ${refs.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`);
		return regex.source;
	}
	return pattern;
}
function parseRecordDef(def, refs) {
	var _a2$1, _b2$1, _c, _d, _e, _f;
	const schema = {
		type: "object",
		additionalProperties: (_a2$1 = parseDef(def.valueType._def, {
			...refs,
			currentPath: [...refs.currentPath, "additionalProperties"]
		})) != null ? _a2$1 : refs.allowedAdditionalProperties
	};
	if (((_b2$1 = def.keyType) == null ? void 0 : _b2$1._def.typeName) === ZodFirstPartyTypeKind.ZodString && ((_c = def.keyType._def.checks) == null ? void 0 : _c.length)) {
		const { type, ...keyType } = parseStringDef(def.keyType._def, refs);
		return {
			...schema,
			propertyNames: keyType
		};
	} else if (((_d = def.keyType) == null ? void 0 : _d._def.typeName) === ZodFirstPartyTypeKind.ZodEnum) return {
		...schema,
		propertyNames: { enum: def.keyType._def.values }
	};
	else if (((_e = def.keyType) == null ? void 0 : _e._def.typeName) === ZodFirstPartyTypeKind.ZodBranded && def.keyType._def.type._def.typeName === ZodFirstPartyTypeKind.ZodString && ((_f = def.keyType._def.type._def.checks) == null ? void 0 : _f.length)) {
		const { type, ...keyType } = parseBrandedDef(def.keyType._def, refs);
		return {
			...schema,
			propertyNames: keyType
		};
	}
	return schema;
}
function parseMapDef(def, refs) {
	if (refs.mapStrategy === "record") return parseRecordDef(def, refs);
	return {
		type: "array",
		maxItems: 125,
		items: {
			type: "array",
			items: [parseDef(def.keyType._def, {
				...refs,
				currentPath: [
					...refs.currentPath,
					"items",
					"items",
					"0"
				]
			}) || parseAnyDef(), parseDef(def.valueType._def, {
				...refs,
				currentPath: [
					...refs.currentPath,
					"items",
					"items",
					"1"
				]
			}) || parseAnyDef()],
			minItems: 2,
			maxItems: 2
		}
	};
}
function parseNativeEnumDef(def) {
	const object = def.values;
	const actualValues = Object.keys(def.values).filter((key) => {
		return typeof object[object[key]] !== "number";
	}).map((key) => object[key]);
	const parsedTypes = Array.from(new Set(actualValues.map((values) => typeof values)));
	return {
		type: parsedTypes.length === 1 ? parsedTypes[0] === "string" ? "string" : "number" : ["string", "number"],
		enum: actualValues
	};
}
function parseNeverDef() {
	return { not: parseAnyDef() };
}
function parseNullDef() {
	return { type: "null" };
}
var primitiveMappings = {
	ZodString: "string",
	ZodNumber: "number",
	ZodBigInt: "integer",
	ZodBoolean: "boolean",
	ZodNull: "null"
};
function parseUnionDef(def, refs) {
	const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
	if (options.every((x) => x._def.typeName in primitiveMappings && (!x._def.checks || !x._def.checks.length))) {
		const types = options.reduce((types2, x) => {
			const type = primitiveMappings[x._def.typeName];
			return type && !types2.includes(type) ? [...types2, type] : types2;
		}, []);
		return { type: types.length > 1 ? types : types[0] };
	} else if (options.every((x) => x._def.typeName === "ZodLiteral" && !x.description)) {
		const types = options.reduce((acc, x) => {
			const type = typeof x._def.value;
			switch (type) {
				case "string":
				case "number":
				case "boolean": return [...acc, type];
				case "bigint": return [...acc, "integer"];
				case "object": if (x._def.value === null) return [...acc, "null"];
				case "symbol":
				case "undefined":
				case "function":
				default: return acc;
			}
		}, []);
		if (types.length === options.length) {
			const uniqueTypes = types.filter((x, i, a) => a.indexOf(x) === i);
			return {
				type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0],
				enum: options.reduce((acc, x) => {
					return acc.includes(x._def.value) ? acc : [...acc, x._def.value];
				}, [])
			};
		}
	} else if (options.every((x) => x._def.typeName === "ZodEnum")) return {
		type: "string",
		enum: options.reduce((acc, x) => [...acc, ...x._def.values.filter((x2) => !acc.includes(x2))], [])
	};
	return asAnyOf(def, refs);
}
var asAnyOf = (def, refs) => {
	const anyOf = (def.options instanceof Map ? Array.from(def.options.values()) : def.options).map((x, i) => parseDef(x._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"anyOf",
			`${i}`
		]
	})).filter((x) => !!x && (!refs.strictUnions || typeof x === "object" && Object.keys(x).length > 0));
	return anyOf.length ? { anyOf } : void 0;
};
function parseNullableDef(def, refs) {
	if ([
		"ZodString",
		"ZodNumber",
		"ZodBigInt",
		"ZodBoolean",
		"ZodNull"
	].includes(def.innerType._def.typeName) && (!def.innerType._def.checks || !def.innerType._def.checks.length)) return { type: [primitiveMappings[def.innerType._def.typeName], "null"] };
	const base = parseDef(def.innerType._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"anyOf",
			"0"
		]
	});
	return base && { anyOf: [base, { type: "null" }] };
}
function parseNumberDef(def) {
	const res = { type: "number" };
	if (!def.checks) return res;
	for (const check of def.checks) switch (check.kind) {
		case "int":
			res.type = "integer";
			break;
		case "min":
			if (check.inclusive) res.minimum = check.value;
			else res.exclusiveMinimum = check.value;
			break;
		case "max":
			if (check.inclusive) res.maximum = check.value;
			else res.exclusiveMaximum = check.value;
			break;
		case "multipleOf":
			res.multipleOf = check.value;
			break;
	}
	return res;
}
function parseObjectDef(def, refs) {
	const result = {
		type: "object",
		properties: {}
	};
	const required = [];
	const shape = def.shape();
	for (const propName in shape) {
		let propDef = shape[propName];
		if (propDef === void 0 || propDef._def === void 0) continue;
		const propOptional = safeIsOptional(propDef);
		const parsedDef = parseDef(propDef._def, {
			...refs,
			currentPath: [
				...refs.currentPath,
				"properties",
				propName
			],
			propertyPath: [
				...refs.currentPath,
				"properties",
				propName
			]
		});
		if (parsedDef === void 0) continue;
		result.properties[propName] = parsedDef;
		if (!propOptional) required.push(propName);
	}
	if (required.length) result.required = required;
	const additionalProperties = decideAdditionalProperties(def, refs);
	if (additionalProperties !== void 0) result.additionalProperties = additionalProperties;
	return result;
}
function decideAdditionalProperties(def, refs) {
	if (def.catchall._def.typeName !== "ZodNever") return parseDef(def.catchall._def, {
		...refs,
		currentPath: [...refs.currentPath, "additionalProperties"]
	});
	switch (def.unknownKeys) {
		case "passthrough": return refs.allowedAdditionalProperties;
		case "strict": return refs.rejectedAdditionalProperties;
		case "strip": return refs.removeAdditionalStrategy === "strict" ? refs.allowedAdditionalProperties : refs.rejectedAdditionalProperties;
	}
}
function safeIsOptional(schema) {
	try {
		return schema.isOptional();
	} catch (e) {
		return true;
	}
}
var parseOptionalDef = (def, refs) => {
	var _a2$1;
	if (refs.currentPath.toString() === ((_a2$1 = refs.propertyPath) == null ? void 0 : _a2$1.toString())) return parseDef(def.innerType._def, refs);
	const innerSchema = parseDef(def.innerType._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"anyOf",
			"1"
		]
	});
	return innerSchema ? { anyOf: [{ not: parseAnyDef() }, innerSchema] } : parseAnyDef();
};
var parsePipelineDef = (def, refs) => {
	if (refs.pipeStrategy === "input") return parseDef(def.in._def, refs);
	else if (refs.pipeStrategy === "output") return parseDef(def.out._def, refs);
	const a = parseDef(def.in._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"allOf",
			"0"
		]
	});
	return { allOf: [a, parseDef(def.out._def, {
		...refs,
		currentPath: [
			...refs.currentPath,
			"allOf",
			a ? "1" : "0"
		]
	})].filter((x) => x !== void 0) };
};
function parsePromiseDef(def, refs) {
	return parseDef(def.type._def, refs);
}
function parseSetDef(def, refs) {
	const schema = {
		type: "array",
		uniqueItems: true,
		items: parseDef(def.valueType._def, {
			...refs,
			currentPath: [...refs.currentPath, "items"]
		})
	};
	if (def.minSize) schema.minItems = def.minSize.value;
	if (def.maxSize) schema.maxItems = def.maxSize.value;
	return schema;
}
function parseTupleDef(def, refs) {
	if (def.rest) return {
		type: "array",
		minItems: def.items.length,
		items: def.items.map((x, i) => parseDef(x._def, {
			...refs,
			currentPath: [
				...refs.currentPath,
				"items",
				`${i}`
			]
		})).reduce((acc, x) => x === void 0 ? acc : [...acc, x], []),
		additionalItems: parseDef(def.rest._def, {
			...refs,
			currentPath: [...refs.currentPath, "additionalItems"]
		})
	};
	else return {
		type: "array",
		minItems: def.items.length,
		maxItems: def.items.length,
		items: def.items.map((x, i) => parseDef(x._def, {
			...refs,
			currentPath: [
				...refs.currentPath,
				"items",
				`${i}`
			]
		})).reduce((acc, x) => x === void 0 ? acc : [...acc, x], [])
	};
}
function parseUndefinedDef() {
	return { not: parseAnyDef() };
}
function parseUnknownDef() {
	return parseAnyDef();
}
var parseReadonlyDef = (def, refs) => {
	return parseDef(def.innerType._def, refs);
};
var selectParser = (def, typeName, refs) => {
	switch (typeName) {
		case ZodFirstPartyTypeKind.ZodString: return parseStringDef(def, refs);
		case ZodFirstPartyTypeKind.ZodNumber: return parseNumberDef(def);
		case ZodFirstPartyTypeKind.ZodObject: return parseObjectDef(def, refs);
		case ZodFirstPartyTypeKind.ZodBigInt: return parseBigintDef(def);
		case ZodFirstPartyTypeKind.ZodBoolean: return parseBooleanDef();
		case ZodFirstPartyTypeKind.ZodDate: return parseDateDef(def, refs);
		case ZodFirstPartyTypeKind.ZodUndefined: return parseUndefinedDef();
		case ZodFirstPartyTypeKind.ZodNull: return parseNullDef();
		case ZodFirstPartyTypeKind.ZodArray: return parseArrayDef(def, refs);
		case ZodFirstPartyTypeKind.ZodUnion:
		case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: return parseUnionDef(def, refs);
		case ZodFirstPartyTypeKind.ZodIntersection: return parseIntersectionDef(def, refs);
		case ZodFirstPartyTypeKind.ZodTuple: return parseTupleDef(def, refs);
		case ZodFirstPartyTypeKind.ZodRecord: return parseRecordDef(def, refs);
		case ZodFirstPartyTypeKind.ZodLiteral: return parseLiteralDef(def);
		case ZodFirstPartyTypeKind.ZodEnum: return parseEnumDef(def);
		case ZodFirstPartyTypeKind.ZodNativeEnum: return parseNativeEnumDef(def);
		case ZodFirstPartyTypeKind.ZodNullable: return parseNullableDef(def, refs);
		case ZodFirstPartyTypeKind.ZodOptional: return parseOptionalDef(def, refs);
		case ZodFirstPartyTypeKind.ZodMap: return parseMapDef(def, refs);
		case ZodFirstPartyTypeKind.ZodSet: return parseSetDef(def, refs);
		case ZodFirstPartyTypeKind.ZodLazy: return () => def.getter()._def;
		case ZodFirstPartyTypeKind.ZodPromise: return parsePromiseDef(def, refs);
		case ZodFirstPartyTypeKind.ZodNaN:
		case ZodFirstPartyTypeKind.ZodNever: return parseNeverDef();
		case ZodFirstPartyTypeKind.ZodEffects: return parseEffectsDef(def, refs);
		case ZodFirstPartyTypeKind.ZodAny: return parseAnyDef();
		case ZodFirstPartyTypeKind.ZodUnknown: return parseUnknownDef();
		case ZodFirstPartyTypeKind.ZodDefault: return parseDefaultDef(def, refs);
		case ZodFirstPartyTypeKind.ZodBranded: return parseBrandedDef(def, refs);
		case ZodFirstPartyTypeKind.ZodReadonly: return parseReadonlyDef(def, refs);
		case ZodFirstPartyTypeKind.ZodCatch: return parseCatchDef(def, refs);
		case ZodFirstPartyTypeKind.ZodPipeline: return parsePipelineDef(def, refs);
		case ZodFirstPartyTypeKind.ZodFunction:
		case ZodFirstPartyTypeKind.ZodVoid:
		case ZodFirstPartyTypeKind.ZodSymbol: return;
		default: return /* @__PURE__ */ ((_) => void 0)(typeName);
	}
};
var getRelativePath = (pathA, pathB) => {
	let i = 0;
	for (; i < pathA.length && i < pathB.length; i++) if (pathA[i] !== pathB[i]) break;
	return [(pathA.length - i).toString(), ...pathB.slice(i)].join("/");
};
function parseDef(def, refs, forceResolution = false) {
	var _a2$1;
	const seenItem = refs.seen.get(def);
	if (refs.override) {
		const overrideResult = (_a2$1 = refs.override) == null ? void 0 : _a2$1.call(refs, def, refs, seenItem, forceResolution);
		if (overrideResult !== ignoreOverride) return overrideResult;
	}
	if (seenItem && !forceResolution) {
		const seenSchema = get$ref(seenItem, refs);
		if (seenSchema !== void 0) return seenSchema;
	}
	const newItem = {
		def,
		path: refs.currentPath,
		jsonSchema: void 0
	};
	refs.seen.set(def, newItem);
	const jsonSchemaOrGetter = selectParser(def, def.typeName, refs);
	const jsonSchema2 = typeof jsonSchemaOrGetter === "function" ? parseDef(jsonSchemaOrGetter(), refs) : jsonSchemaOrGetter;
	if (jsonSchema2) addMeta(def, refs, jsonSchema2);
	if (refs.postProcess) {
		const postProcessResult = refs.postProcess(jsonSchema2, def, refs);
		newItem.jsonSchema = jsonSchema2;
		return postProcessResult;
	}
	newItem.jsonSchema = jsonSchema2;
	return jsonSchema2;
}
var get$ref = (item, refs) => {
	switch (refs.$refStrategy) {
		case "root": return { $ref: item.path.join("/") };
		case "relative": return { $ref: getRelativePath(refs.currentPath, item.path) };
		case "none":
		case "seen":
			if (item.path.length < refs.currentPath.length && item.path.every((value, index) => refs.currentPath[index] === value)) {
				console.warn(`Recursive reference detected at ${refs.currentPath.join("/")}! Defaulting to any`);
				return parseAnyDef();
			}
			return refs.$refStrategy === "seen" ? parseAnyDef() : void 0;
	}
};
var addMeta = (def, refs, jsonSchema2) => {
	if (def.description) jsonSchema2.description = def.description;
	return jsonSchema2;
};
var getRefs = (options) => {
	const _options = getDefaultOptions(options);
	const currentPath = _options.name !== void 0 ? [
		..._options.basePath,
		_options.definitionPath,
		_options.name
	] : _options.basePath;
	return {
		..._options,
		currentPath,
		propertyPath: void 0,
		seen: new Map(Object.entries(_options.definitions).map(([name2$1, def]) => [def._def, {
			def: def._def,
			path: [
				..._options.basePath,
				_options.definitionPath,
				name2$1
			],
			jsonSchema: void 0
		}]))
	};
};
var zod3ToJsonSchema = (schema, options) => {
	var _a2$1;
	const refs = getRefs(options);
	let definitions = typeof options === "object" && options.definitions ? Object.entries(options.definitions).reduce((acc, [name3$1, schema2]) => {
		var _a3$1;
		return {
			...acc,
			[name3$1]: (_a3$1 = parseDef(schema2._def, {
				...refs,
				currentPath: [
					...refs.basePath,
					refs.definitionPath,
					name3$1
				]
			}, true)) != null ? _a3$1 : parseAnyDef()
		};
	}, {}) : void 0;
	const name2$1 = typeof options === "string" ? options : (options == null ? void 0 : options.nameStrategy) === "title" ? void 0 : options == null ? void 0 : options.name;
	const main = (_a2$1 = parseDef(schema._def, name2$1 === void 0 ? refs : {
		...refs,
		currentPath: [
			...refs.basePath,
			refs.definitionPath,
			name2$1
		]
	}, false)) != null ? _a2$1 : parseAnyDef();
	const title = typeof options === "object" && options.name !== void 0 && options.nameStrategy === "title" ? options.name : void 0;
	if (title !== void 0) main.title = title;
	const combined = name2$1 === void 0 ? definitions ? {
		...main,
		[refs.definitionPath]: definitions
	} : main : {
		$ref: [
			...refs.$refStrategy === "relative" ? [] : refs.basePath,
			refs.definitionPath,
			name2$1
		].join("/"),
		[refs.definitionPath]: {
			...definitions,
			[name2$1]: main
		}
	};
	combined.$schema = "http://json-schema.org/draft-07/schema#";
	return combined;
};
var schemaSymbol = Symbol.for("vercel.ai.schema");
function jsonSchema(jsonSchema2, { validate } = {}) {
	return {
		[schemaSymbol]: true,
		_type: void 0,
		get jsonSchema() {
			if (typeof jsonSchema2 === "function") jsonSchema2 = jsonSchema2();
			return jsonSchema2;
		},
		validate
	};
}
function isSchema(value) {
	return typeof value === "object" && value !== null && schemaSymbol in value && value[schemaSymbol] === true && "jsonSchema" in value && "validate" in value;
}
function asSchema(schema) {
	return schema == null ? jsonSchema({
		properties: {},
		additionalProperties: false
	}) : isSchema(schema) ? schema : "~standard" in schema ? schema["~standard"].vendor === "zod" ? zodSchema(schema) : standardSchema(schema) : schema();
}
function standardSchema(standardSchema2) {
	return jsonSchema(() => addAdditionalPropertiesToJsonSchema(standardSchema2["~standard"].jsonSchema.input({ target: "draft-07" })), { validate: async (value) => {
		const result = await standardSchema2["~standard"].validate(value);
		return "value" in result ? {
			success: true,
			value: result.value
		} : {
			success: false,
			error: new TypeValidationError({
				value,
				cause: result.issues
			})
		};
	} });
}
function zod3Schema(zodSchema2, options) {
	var _a2$1;
	const useReferences = (_a2$1 = options == null ? void 0 : options.useReferences) != null ? _a2$1 : false;
	return jsonSchema(() => zod3ToJsonSchema(zodSchema2, { $refStrategy: useReferences ? "root" : "none" }), { validate: async (value) => {
		const result = await zodSchema2.safeParseAsync(value);
		return result.success ? {
			success: true,
			value: result.data
		} : {
			success: false,
			error: result.error
		};
	} });
}
function zod4Schema(zodSchema2, options) {
	var _a2$1;
	const useReferences = (_a2$1 = options == null ? void 0 : options.useReferences) != null ? _a2$1 : false;
	return jsonSchema(() => addAdditionalPropertiesToJsonSchema(z4.toJSONSchema(zodSchema2, {
		target: "draft-7",
		io: "input",
		reused: useReferences ? "ref" : "inline"
	})), { validate: async (value) => {
		const result = await z4.safeParseAsync(zodSchema2, value);
		return result.success ? {
			success: true,
			value: result.data
		} : {
			success: false,
			error: result.error
		};
	} });
}
function isZod4Schema(zodSchema2) {
	return "_zod" in zodSchema2;
}
function zodSchema(zodSchema2, options) {
	if (isZod4Schema(zodSchema2)) return zod4Schema(zodSchema2, options);
	else return zod3Schema(zodSchema2, options);
}
async function validateTypes({ value, schema, context }) {
	const result = await safeValidateTypes({
		value,
		schema,
		context
	});
	if (!result.success) throw TypeValidationError.wrap({
		value,
		cause: result.error,
		context
	});
	return result.value;
}
async function safeValidateTypes({ value, schema, context }) {
	const actualSchema = asSchema(schema);
	try {
		if (actualSchema.validate == null) return {
			success: true,
			value,
			rawValue: value
		};
		const result = await actualSchema.validate(value);
		if (result.success) return {
			success: true,
			value: result.value,
			rawValue: value
		};
		return {
			success: false,
			error: TypeValidationError.wrap({
				value,
				cause: result.error,
				context
			}),
			rawValue: value
		};
	} catch (error) {
		return {
			success: false,
			error: TypeValidationError.wrap({
				value,
				cause: error,
				context
			}),
			rawValue: value
		};
	}
}
async function parseJSON({ text, schema }) {
	try {
		const value = secureJsonParse(text);
		if (schema == null) return value;
		return validateTypes({
			value,
			schema
		});
	} catch (error) {
		if (JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) throw error;
		throw new JSONParseError({
			text,
			cause: error
		});
	}
}
async function safeParseJSON({ text, schema }) {
	try {
		const value = secureJsonParse(text);
		if (schema == null) return {
			success: true,
			value,
			rawValue: value
		};
		return await safeValidateTypes({
			value,
			schema
		});
	} catch (error) {
		return {
			success: false,
			error: JSONParseError.isInstance(error) ? error : new JSONParseError({
				text,
				cause: error
			}),
			rawValue: void 0
		};
	}
}
function parseJsonEventStream({ stream, schema }) {
	return stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).pipeThrough(new TransformStream({ async transform({ data }, controller) {
		if (data === "[DONE]") return;
		controller.enqueue(await safeParseJSON({
			text: data,
			schema
		}));
	} }));
}
async function parseProviderOptions({ provider, providerOptions, schema }) {
	if ((providerOptions == null ? void 0 : providerOptions[provider]) == null) return;
	const parsedProviderOptions = await safeValidateTypes({
		value: providerOptions[provider],
		schema
	});
	if (!parsedProviderOptions.success) throw new InvalidArgumentError({
		argument: "providerOptions",
		message: `invalid ${provider} provider options`,
		cause: parsedProviderOptions.error
	});
	return parsedProviderOptions.value;
}
var getOriginalFetch2 = () => globalThis.fetch;
var postJsonToApi = async ({ url, headers, body, failedResponseHandler, successfulResponseHandler, abortSignal, fetch: fetch2 }) => postToApi({
	url,
	headers: {
		"Content-Type": "application/json",
		...headers
	},
	body: {
		content: JSON.stringify(body),
		values: body
	},
	failedResponseHandler,
	successfulResponseHandler,
	abortSignal,
	fetch: fetch2
});
var postToApi = async ({ url, headers = {}, body, successfulResponseHandler, failedResponseHandler, abortSignal, fetch: fetch2 = getOriginalFetch2() }) => {
	try {
		const response = await fetch2(url, {
			method: "POST",
			headers: withUserAgentSuffix(headers, `ai-sdk/provider-utils/${VERSION}`, getRuntimeEnvironmentUserAgent()),
			body: body.content,
			signal: abortSignal
		});
		const responseHeaders = extractResponseHeaders(response);
		if (!response.ok) {
			let errorInformation;
			try {
				errorInformation = await failedResponseHandler({
					response,
					url,
					requestBodyValues: body.values
				});
			} catch (error) {
				if (isAbortError(error) || APICallError.isInstance(error)) throw error;
				throw new APICallError({
					message: "Failed to process error response",
					cause: error,
					statusCode: response.status,
					url,
					responseHeaders,
					requestBodyValues: body.values
				});
			}
			throw errorInformation.value;
		}
		try {
			return await successfulResponseHandler({
				response,
				url,
				requestBodyValues: body.values
			});
		} catch (error) {
			if (error instanceof Error) {
				if (isAbortError(error) || APICallError.isInstance(error)) throw error;
			}
			throw new APICallError({
				message: "Failed to process successful response",
				cause: error,
				statusCode: response.status,
				url,
				responseHeaders,
				requestBodyValues: body.values
			});
		}
	} catch (error) {
		throw handleFetchError({
			error,
			url,
			requestBodyValues: body.values
		});
	}
};
var createJsonErrorResponseHandler = ({ errorSchema, errorToMessage, isRetryable }) => async ({ response, url, requestBodyValues }) => {
	const responseBody = await response.text();
	const responseHeaders = extractResponseHeaders(response);
	if (responseBody.trim() === "") return {
		responseHeaders,
		value: new APICallError({
			message: response.statusText,
			url,
			requestBodyValues,
			statusCode: response.status,
			responseHeaders,
			responseBody,
			isRetryable: isRetryable == null ? void 0 : isRetryable(response)
		})
	};
	try {
		const parsedError = await parseJSON({
			text: responseBody,
			schema: errorSchema
		});
		return {
			responseHeaders,
			value: new APICallError({
				message: errorToMessage(parsedError),
				url,
				requestBodyValues,
				statusCode: response.status,
				responseHeaders,
				responseBody,
				data: parsedError,
				isRetryable: isRetryable == null ? void 0 : isRetryable(response, parsedError)
			})
		};
	} catch (parseError) {
		return {
			responseHeaders,
			value: new APICallError({
				message: response.statusText,
				url,
				requestBodyValues,
				statusCode: response.status,
				responseHeaders,
				responseBody,
				isRetryable: isRetryable == null ? void 0 : isRetryable(response)
			})
		};
	}
};
var createEventSourceResponseHandler = (chunkSchema) => async ({ response }) => {
	const responseHeaders = extractResponseHeaders(response);
	if (response.body == null) throw new EmptyResponseBodyError({});
	return {
		responseHeaders,
		value: parseJsonEventStream({
			stream: response.body,
			schema: chunkSchema
		})
	};
};
var createJsonResponseHandler = (responseSchema) => async ({ response, url, requestBodyValues }) => {
	const responseBody = await response.text();
	const parsedResult = await safeParseJSON({
		text: responseBody,
		schema: responseSchema
	});
	const responseHeaders = extractResponseHeaders(response);
	if (!parsedResult.success) throw new APICallError({
		message: "Invalid JSON response",
		cause: parsedResult.error,
		statusCode: response.status,
		responseHeaders,
		responseBody,
		url,
		requestBodyValues
	});
	return {
		responseHeaders,
		value: parsedResult.value,
		rawValue: parsedResult.rawValue
	};
};
function withoutTrailingSlash(url) {
	return url == null ? void 0 : url.replace(/\/$/, "");
}

//#endregion
//#region ../node_modules/@databricks/ai-sdk-provider/dist/index.mjs
const chatAgentToolCallSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		arguments: z.string()
	}),
	id: z.string()
});
const chatAgentAssistantMessageSchema = z.object({
	role: z.literal("assistant"),
	content: z.string(),
	id: z.string(),
	name: z.string().optional(),
	tool_calls: z.array(chatAgentToolCallSchema).optional()
});
const chatAgentToolMessageSchema = z.object({
	role: z.literal("tool"),
	name: z.string(),
	content: z.string(),
	tool_call_id: z.string(),
	id: z.string(),
	attachments: z.record(z.string(), z.unknown()).optional()
});
const chatAgentUserMessageSchema = z.object({
	role: z.literal("user"),
	content: z.string(),
	id: z.string()
});
const chatAgentMessageSchema = z.discriminatedUnion("role", [
	chatAgentAssistantMessageSchema,
	chatAgentToolMessageSchema,
	chatAgentUserMessageSchema
]);
const chatAgentChunkSchema = z.object({
	id: z.string(),
	delta: chatAgentMessageSchema
});
const chatAgentResponseSchema = z.object({
	id: z.string(),
	messages: z.array(chatAgentMessageSchema)
});
const convertChatAgentChunkToMessagePart = (chunk) => {
	const parts = [];
	if (chunk.delta.role === "assistant") {
		if (chunk.delta.content) parts.push({
			type: "text-delta",
			id: chunk.delta.id,
			delta: chunk.delta.content
		});
		chunk.delta.tool_calls?.forEach((toolCall) => {
			parts.push({
				type: "tool-call",
				toolCallId: toolCall.id,
				input: toolCall.function.arguments,
				toolName: toolCall.function.name,
				dynamic: true,
				providerExecuted: true
			});
		});
	} else if (chunk.delta.role === "tool") parts.push({
		type: "tool-result",
		toolCallId: chunk.delta.tool_call_id,
		result: chunk.delta.content,
		toolName: chunk.delta.name ?? "unknown"
	});
	return parts;
};
const convertChatAgentResponseToMessagePart = (response) => {
	const parts = [];
	for (const message of response.messages) if (message.role === "assistant") {
		parts.push({
			type: "text",
			text: message.content
		});
		for (const part of message.tool_calls ?? []) parts.push({
			type: "tool-call",
			toolCallId: part.id,
			input: part.function.arguments,
			toolName: part.function.name,
			dynamic: true,
			providerExecuted: true
		});
	} else if (message.role === "tool") parts.push({
		type: "tool-result",
		toolCallId: message.tool_call_id,
		result: message.content,
		toolName: message.name ?? "unknown"
	});
	return parts;
};
const convertLanguageModelV3PromptToChatAgentResponse = (prompt) => {
	const messages = [];
	let messageIndex = 0;
	for (const msg of prompt) switch (msg.role) {
		case "system": break;
		case "user": {
			const converted = convertUserMessage$1(msg, messageIndex);
			messages.push(converted);
			messageIndex++;
			break;
		}
		case "assistant": {
			const converted = convertAssistantMessage$1(msg, messageIndex);
			messages.push(...converted);
			messageIndex += converted.length;
			break;
		}
		case "tool": {
			const converted = convertToolMessage(msg, messageIndex);
			messages.push(...converted);
			messageIndex += converted.length;
			break;
		}
	}
	return messages;
};
const convertUserMessage$1 = (msg, messageIndex) => {
	return {
		role: "user",
		content: (msg.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n"),
		id: `user-${messageIndex}`
	};
};
const convertAssistantMessage$1 = (msg, startIndex) => {
	const messages = [];
	let messageIndex = startIndex;
	const textContent = (msg.content ?? []).filter((part) => part.type === "text" || part.type === "reasoning").map((part) => part.type === "text" ? part.text : part.text).join("\n");
	const toolCalls = (msg.content ?? []).filter((part) => part.type === "tool-call").map((call) => ({
		type: "function",
		id: call.toolCallId,
		function: {
			name: call.toolName,
			arguments: typeof call.input === "string" ? call.input : JSON.stringify(call.input ?? {})
		}
	}));
	messages.push({
		role: "assistant",
		content: textContent,
		id: `assistant-${messageIndex++}`,
		tool_calls: toolCalls.length > 0 ? toolCalls : void 0
	});
	for (const part of msg.content ?? []) if (part.type === "tool-result") messages.push({
		role: "tool",
		name: part.toolName,
		content: convertToolResultOutput(part.output),
		tool_call_id: part.toolCallId,
		id: `tool-${messageIndex++}`
	});
	return messages;
};
const convertToolMessage = (msg, startIndex) => {
	const messages = [];
	let messageIndex = startIndex;
	for (const part of msg.content ?? []) if (part.type === "tool-result") messages.push({
		role: "tool",
		name: part.toolName,
		content: convertToolResultOutput(part.output),
		tool_call_id: part.toolCallId,
		id: `tool-${messageIndex++}`
	});
	return messages;
};
const convertToolResultOutput = (output) => {
	switch (output.type) {
		case "text":
		case "error-text": return output.value;
		case "json":
		case "error-json": return JSON.stringify(output.value);
		case "content": return output.value.map((p) => p.type === "text" ? p.text : "").filter(Boolean).join("\n");
		default: return "";
	}
};
/**
* Compose an arbitrary number of `DatabricksStreamPartTransformer`s.
*
* The returned function has the exact same signature as a normal transformer,
* but its `out`‑element type is inferred from the **last** transformer you pass
* in.
*
* Runtime behaviour:
*   1️⃣ Call the first transformer with the supplied `parts` and the
*      caller‑provided `last` (usually `null`).
*   2️⃣ Take its `out` and `last` and feed them to the next transformer.
*   3️⃣ …repeat until the last transformer runs.
*   4️⃣ Return the `out`/`last` of that final transformer.
*/
function composeDatabricksStreamPartTransformers(...transformers) {
	return (initialParts, last = null) => {
		let currentParts = initialParts;
		for (const fn of transformers) currentParts = fn(currentParts, last).out;
		return { out: currentParts };
	};
}
/**
* Injects start/end deltas for sequential streams.
*/
const applyDeltaBoundaryTransform = (parts, last) => {
	const out = [];
	const lastDeltaType = maybeGetDeltaType(last);
	for (const incoming of parts) {
		const incomingDeltaType = maybeGetDeltaType(incoming);
		const incomingId = getPartId$1(incoming);
		const lastId = getPartId$1(last);
		if (Boolean(isDeltaPart(last) && isDeltaPart(incoming)) && Boolean(lastDeltaType && incomingDeltaType) && Boolean(lastDeltaType === incomingDeltaType) && Boolean(incomingId && lastId && incomingId === lastId)) {
			out.push(incoming);
			continue;
		}
		if (isDeltaPart(last)) out.push({
			type: `${getDeltaType(last)}-end`,
			id: last.id
		});
		if (isDeltaPart(incoming)) {
			out.push({
				type: `${getDeltaType(incoming)}-start`,
				id: incoming.id
			}, incoming);
			continue;
		}
		out.push(incoming);
	}
	return { out };
};
const isDeltaIsh = (part) => part?.type.startsWith("text-") || part?.type.startsWith("reasoning-") || false;
const maybeGetDeltaType = (part) => {
	if (!isDeltaIsh(part)) return null;
	if (part.type.startsWith("text-")) return "text";
	if (part.type.startsWith("reasoning-")) return "reasoning";
	return null;
};
const getDeltaType = (part) => {
	if (part.type.startsWith("text-")) return "text";
	if (part.type.startsWith("reasoning-")) return "reasoning";
	throw new Error(`Unknown delta type: ${part.type}`);
};
const isDeltaPart = (part) => part?.type === "text-delta" || part?.type === "reasoning-delta";
const getPartId$1 = (part) => {
	if (part && "id" in part) return part.id;
};
/**
* Allows stream transformations to be composed together.
*
* Currently only used to automatically inject start/end
* deltas since the APIs does not supply the necessary events.
*/
const getDatabricksLanguageModelTransformStream = () => {
	let lastChunk = null;
	const deltaEndByTypeAndId = /* @__PURE__ */ new Set();
	const transformerStreamParts = composeDatabricksStreamPartTransformers(applyDeltaBoundaryTransform);
	return new TransformStream({
		transform(chunk, controller) {
			if (chunk.type === "raw") {
				controller.enqueue(chunk);
				return;
			}
			const { out } = transformerStreamParts([chunk], lastChunk);
			out.forEach((transformedChunk) => {
				const group = getDeltaGroup(transformedChunk.type);
				const endKey = makeEndKey(getPartId(transformedChunk), group);
				if (endKey && deltaEndByTypeAndId.has(endKey)) return;
				if (transformedChunk.type === "text-end" || transformedChunk.type === "reasoning-end") {
					/**
					* We register when a delta ends.
					* We rely on response.output_item.done chunks to display non streamed data
					* so we need to deduplicate them with their corresponding delta chunks.
					*/
					const endGroup = getDeltaGroup(transformedChunk.type);
					const key = makeEndKey(getPartId(transformedChunk), endGroup);
					if (key) deltaEndByTypeAndId.add(key);
				}
				controller.enqueue(transformedChunk);
			});
			lastChunk = out[out.length - 1] ?? lastChunk;
		},
		flush(controller) {
			if (lastChunk?.type === "text-delta") controller.enqueue({
				type: "text-end",
				id: lastChunk.id
			});
			if (lastChunk?.type === "reasoning-delta") controller.enqueue({
				type: "reasoning-end",
				id: lastChunk.id
			});
		}
	});
};
const getDeltaGroup = (type) => {
	if (type.startsWith("text-")) return "text";
	if (type.startsWith("reasoning-")) return "reasoning";
	return null;
};
const getPartId = (part) => {
	if ("id" in part) return part.id;
};
const makeEndKey = (id, group) => id && group ? `${group}:${id}` : null;
var DatabricksChatAgentLanguageModel = class {
	specificationVersion = "v3";
	modelId;
	config;
	constructor(modelId, config) {
		this.modelId = modelId;
		this.config = config;
	}
	get provider() {
		return this.config.provider;
	}
	supportedUrls = {};
	async doGenerate(options) {
		const { value: response } = await postJsonToApi({
			...this.getArgs({
				config: this.config,
				options,
				stream: false,
				modelId: this.modelId
			}),
			successfulResponseHandler: createJsonResponseHandler(chatAgentResponseSchema),
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			})
		});
		return {
			content: convertChatAgentResponseToMessagePart(response),
			finishReason: {
				raw: void 0,
				unified: "stop"
			},
			usage: {
				inputTokens: {
					total: 0,
					noCache: 0,
					cacheRead: 0,
					cacheWrite: 0
				},
				outputTokens: {
					total: 0,
					text: 0,
					reasoning: 0
				}
			},
			warnings: []
		};
	}
	async doStream(options) {
		const networkArgs = this.getArgs({
			config: this.config,
			options,
			stream: true,
			modelId: this.modelId
		});
		const { responseHeaders, value: response } = await postJsonToApi({
			...networkArgs,
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			}),
			successfulResponseHandler: createEventSourceResponseHandler(chatAgentChunkSchema)
		});
		let finishReason = {
			raw: void 0,
			unified: "other"
		};
		return {
			stream: response.pipeThrough(new TransformStream({
				start(controller) {
					controller.enqueue({
						type: "stream-start",
						warnings: []
					});
				},
				transform(chunk, controller) {
					if (options.includeRawChunks) controller.enqueue({
						type: "raw",
						rawValue: chunk.rawValue
					});
					if (!chunk.success) {
						finishReason = {
							raw: void 0,
							unified: "error"
						};
						controller.enqueue({
							type: "error",
							error: chunk.error
						});
						return;
					}
					const parts = convertChatAgentChunkToMessagePart(chunk.value);
					for (const part of parts) controller.enqueue(part);
				},
				flush(controller) {
					controller.enqueue({
						type: "finish",
						finishReason,
						usage: {
							inputTokens: {
								total: 0,
								noCache: 0,
								cacheRead: 0,
								cacheWrite: 0
							},
							outputTokens: {
								total: 0,
								text: 0,
								reasoning: 0
							}
						}
					});
				}
			})).pipeThrough(getDatabricksLanguageModelTransformStream()),
			request: { body: networkArgs.body },
			response: { headers: responseHeaders }
		};
	}
	getArgs({ config, options, stream, modelId }) {
		return {
			body: {
				model: modelId,
				stream,
				messages: convertLanguageModelV3PromptToChatAgentResponse(options.prompt)
			},
			url: config.url({ path: "/completions" }),
			headers: combineHeaders(config.headers(), options.headers),
			fetch: config.fetch,
			abortSignal: options.abortSignal
		};
	}
};
/**
* Response schema
*/
const responsesAgentMessageSchema = z.object({
	type: z.literal("message"),
	role: z.literal("assistant"),
	id: z.string(),
	content: z.array(z.object({
		type: z.literal("output_text"),
		text: z.string(),
		logprobs: z.unknown().nullish(),
		annotations: z.array(z.discriminatedUnion("type", [z.object({
			type: z.literal("url_citation"),
			start_index: z.number(),
			end_index: z.number(),
			url: z.string(),
			title: z.string()
		})])).optional()
	}))
});
const responsesAgentFunctionCallSchema = z.object({
	type: z.literal("function_call"),
	call_id: z.string(),
	name: z.string(),
	arguments: z.string(),
	id: z.string()
});
const responsesAgentReasoningSchema = z.object({
	type: z.literal("reasoning"),
	id: z.string(),
	encrypted_content: z.string().nullish(),
	summary: z.array(z.object({
		type: z.literal("summary_text"),
		text: z.string()
	}))
});
const responsesAgentFunctionCallOutputSchema = z.object({
	type: z.literal("function_call_output"),
	call_id: z.string(),
	output: z.any()
});
const responsesAgentMcpApprovalRequestSchema = z.object({
	type: z.literal("mcp_approval_request"),
	id: z.string(),
	name: z.string(),
	arguments: z.string(),
	server_label: z.string()
});
const responsesAgentMcpApprovalResponseSchema = z.object({
	type: z.literal("mcp_approval_response"),
	id: z.string().optional(),
	approval_request_id: z.string(),
	approve: z.boolean(),
	reason: z.string().nullish()
});
const responsesAgentOutputItem = z.discriminatedUnion("type", [
	responsesAgentMessageSchema,
	responsesAgentFunctionCallSchema,
	responsesAgentReasoningSchema,
	responsesAgentFunctionCallOutputSchema,
	responsesAgentMcpApprovalRequestSchema,
	responsesAgentMcpApprovalResponseSchema
]);
const responsesAgentResponseSchema = z.object({
	id: z.string().optional(),
	created_at: z.number().optional(),
	error: z.object({
		code: z.string(),
		message: z.string()
	}).nullish(),
	model: z.string().optional(),
	output: z.array(responsesAgentOutputItem),
	incomplete_details: z.object({ reason: z.string().nullish().optional() }).nullish(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		total_tokens: z.number()
	}).optional()
}).passthrough();
/**
* Chunk schema
*/
const textDeltaChunkSchema = z.object({
	type: z.literal("response.output_text.delta"),
	item_id: z.string(),
	delta: z.string(),
	logprobs: z.unknown().nullish()
});
const errorChunkSchema = z.object({
	type: z.literal("error"),
	code: z.string(),
	message: z.string(),
	param: z.string().nullish(),
	sequence_number: z.number()
});
const simpleErrorChunkSchema = z.object({
	type: z.undefined().optional(),
	error: z.string()
});
const responseOutputItemDoneSchema = z.object({
	type: z.literal("response.output_item.done"),
	output_index: z.number().optional(),
	item: responsesAgentOutputItem,
	id: z.string().optional()
}).passthrough();
const responseAnnotationAddedSchema = z.object({
	type: z.literal("response.output_text.annotation.added"),
	annotation: z.discriminatedUnion("type", [z.object({
		type: z.literal("url_citation"),
		url: z.string(),
		title: z.string()
	})])
});
const responseReasoningSummaryTextDeltaSchema = z.object({
	type: z.literal("response.reasoning_summary_text.delta"),
	item_id: z.string(),
	summary_index: z.number(),
	delta: z.string()
});
const responseFunctionCallArgumentsDeltaSchema = z.object({
	type: z.literal("response.function_call_arguments.delta"),
	item_id: z.string(),
	delta: z.string(),
	output_index: z.number(),
	sequence_number: z.number()
});
const functionCallOutputChunkSchema = z.object({
	type: z.literal("function_call_output"),
	call_id: z.string(),
	output: z.any()
});
const responsesCompletedSchema = z.object({
	type: z.literal("responses.completed"),
	response: z.object({
		id: z.string(),
		status: z.enum([
			"completed",
			"failed",
			"in_progress",
			"cancelled",
			"queued",
			"incomplete"
		]).optional(),
		incomplete_details: z.object({ reason: z.string().nullish().optional() }).nullish(),
		usage: z.object({
			input_tokens: z.number(),
			output_tokens: z.number(),
			total_tokens: z.number()
		})
	})
});
const responsesAgentChunkSchema = z.union([
	textDeltaChunkSchema,
	responseOutputItemDoneSchema,
	responseAnnotationAddedSchema,
	responseReasoningSummaryTextDeltaSchema,
	responseFunctionCallArgumentsDeltaSchema,
	functionCallOutputChunkSchema,
	errorChunkSchema,
	responsesCompletedSchema,
	simpleErrorChunkSchema
]);
/**
* We use a loose schema for response validation to handle unknown chunks.
*/
const looseResponseAgentChunkSchema = z.union([responsesAgentChunkSchema, z.object({}).loose()]);
const convertResponsesAgentChunkToMessagePart = (chunk, options = { useRemoteToolCalling: false }) => {
	const parts = [];
	if ("error" in chunk) {
		parts.push({
			type: "error",
			error: chunk.error
		});
		return parts;
	}
	switch (chunk.type) {
		case "response.output_text.delta":
			parts.push({
				type: "text-delta",
				id: chunk.item_id,
				delta: chunk.delta,
				providerMetadata: { databricks: { itemId: chunk.item_id } }
			});
			break;
		case "response.reasoning_summary_text.delta":
			parts.push({
				type: "reasoning-delta",
				id: chunk.item_id,
				delta: chunk.delta,
				providerMetadata: { databricks: { itemId: chunk.item_id } }
			});
			break;
		case "function_call_output":
			parts.push({
				type: "tool-result",
				toolCallId: chunk.call_id,
				result: chunk.output != null ? chunk.output : {},
				toolName: options.toolNamesByCallId?.get(chunk.call_id) ?? "unknown"
			});
			break;
		case "response.output_item.done":
			parts.push(...convertOutputItemDone(chunk.item, options));
			break;
		case "response.output_text.annotation.added":
			parts.push({
				type: "source",
				url: chunk.annotation.url,
				title: chunk.annotation.title,
				id: randomUUID(),
				sourceType: "url"
			});
			break;
		case "error":
			parts.push({
				type: "error",
				error: chunk
			});
			break;
		default: break;
	}
	return parts;
};
const convertOutputItemDone = (item, options) => {
	switch (item.type) {
		case "message": {
			const firstContent = item.content[0];
			if (!firstContent) return [];
			return [{
				type: "text-delta",
				id: item.id,
				delta: firstContent.text,
				providerMetadata: { databricks: {
					itemId: item.id,
					itemType: "response.output_item.done"
				} }
			}];
		}
		case "function_call": return [{
			type: "tool-call",
			toolCallId: item.call_id,
			toolName: item.name,
			input: item.arguments,
			...options.useRemoteToolCalling && {
				dynamic: true,
				providerExecuted: true
			},
			providerMetadata: { databricks: { itemId: item.id } }
		}];
		case "function_call_output": return [{
			type: "tool-result",
			toolCallId: item.call_id,
			result: item.output != null ? item.output : {},
			toolName: options.toolNamesByCallId?.get(item.call_id) ?? "unknown"
		}];
		case "reasoning": {
			const firstSummary = item.summary[0];
			if (!firstSummary) return [];
			return [
				{
					type: "reasoning-start",
					id: item.id
				},
				{
					type: "reasoning-delta",
					id: item.id,
					delta: firstSummary.text,
					providerMetadata: { databricks: { itemId: item.id } }
				},
				{
					type: "reasoning-end",
					id: item.id
				}
			];
		}
		case "mcp_approval_request": return [{
			type: "tool-call",
			toolCallId: item.id,
			toolName: item.name,
			input: item.arguments,
			providerExecuted: true,
			dynamic: true,
			providerMetadata: { databricks: {
				itemId: item.id,
				serverLabel: item.server_label,
				approvalRequestId: item.id
			} }
		}, {
			type: "tool-approval-request",
			approvalId: item.id,
			toolCallId: item.id
		}];
		case "mcp_approval_response": return [{
			type: "tool-result",
			toolCallId: item.approval_request_id,
			toolName: options.toolNamesByCallId?.get(item.approval_request_id) ?? "mcp_approval",
			result: { approved: item.approve },
			providerMetadata: { databricks: { itemId: item.id ?? item.approval_request_id } }
		}];
		default: return [];
	}
};
const convertResponsesAgentResponseToMessagePart = (response, options = { useRemoteToolCalling: false }) => {
	const parts = [];
	const toolNamesByCallId = /* @__PURE__ */ new Map();
	for (const output of response.output) if (output.type === "function_call") toolNamesByCallId.set(output.call_id, output.name);
	else if (output.type === "mcp_approval_request") toolNamesByCallId.set(output.id, output.name);
	for (const output of response.output) switch (output.type) {
		case "message":
			for (const content of output.content) if (content.type === "output_text") parts.push({
				type: "text",
				text: content.text,
				providerMetadata: { databricks: { itemId: output.id } }
			});
			break;
		case "function_call":
			parts.push({
				type: "tool-call",
				toolCallId: output.call_id,
				toolName: output.name,
				input: output.arguments,
				...options.useRemoteToolCalling && {
					dynamic: true,
					providerExecuted: true
				},
				providerMetadata: { databricks: { itemId: output.id } }
			});
			break;
		case "reasoning":
			for (const summary of output.summary) if (summary.type === "summary_text") parts.push({
				type: "reasoning",
				text: summary.text,
				providerMetadata: { databricks: { itemId: output.id } }
			});
			break;
		case "function_call_output":
			parts.push({
				type: "tool-result",
				result: output.output,
				toolCallId: output.call_id,
				toolName: toolNamesByCallId.get(output.call_id) ?? "unknown"
			});
			break;
		case "mcp_approval_request":
			parts.push({
				type: "tool-call",
				toolCallId: output.id,
				toolName: output.name,
				input: output.arguments,
				providerExecuted: true,
				dynamic: true,
				providerMetadata: { databricks: {
					itemId: output.id,
					serverLabel: output.server_label,
					approvalRequestId: output.id
				} }
			});
			parts.push({
				type: "tool-approval-request",
				approvalId: output.id,
				toolCallId: output.id
			});
			break;
		case "mcp_approval_response":
			parts.push({
				type: "tool-result",
				toolCallId: output.approval_request_id,
				toolName: toolNamesByCallId.get(output.approval_request_id) ?? "mcp_approval",
				result: { approved: output.approve },
				providerMetadata: { databricks: { itemId: output.id ?? output.approval_request_id } }
			});
			break;
		default: break;
	}
	return parts;
};
async function convertToResponsesInput({ prompt, systemMessageMode }) {
	const input = [];
	const warnings = [];
	const processedApprovalIds = /* @__PURE__ */ new Set();
	const approvalIdsWithToolResult = /* @__PURE__ */ new Set();
	const toolCallResultsByToolCallId = prompt.filter((p) => p.role === "tool").flatMap((p) => p.content).reduce((reduction, toolCallResult) => {
		if (toolCallResult.type === "tool-result") reduction[toolCallResult.toolCallId] = toolCallResult;
		return reduction;
	}, {});
	for (const { role, content } of prompt) switch (role) {
		case "system":
			switch (systemMessageMode) {
				case "system":
					input.push({
						role: "system",
						content
					});
					break;
				case "developer":
					input.push({
						role: "developer",
						content
					});
					break;
				case "remove":
					warnings.push({
						type: "other",
						message: "system messages are removed for this model"
					});
					break;
				default: {
					const _exhaustiveCheck = systemMessageMode;
					throw new Error(`Unsupported system message mode: ${String(_exhaustiveCheck)}`);
				}
			}
			break;
		case "user":
			input.push({
				role: "user",
				content: content.map((part) => {
					switch (part.type) {
						case "text": return {
							type: "input_text",
							text: part.text
						};
						default: throw new UnsupportedFunctionalityError({ functionality: `part ${JSON.stringify(part)}` });
					}
				})
			});
			break;
		case "assistant":
			for (const part of content) {
				const providerOptions = await parseProviderOptions({
					provider: "databricks",
					providerOptions: part.providerOptions,
					schema: ProviderOptionsSchema$1
				});
				const itemId = providerOptions?.itemId ?? void 0;
				switch (part.type) {
					case "text":
						input.push({
							role: "assistant",
							content: [{
								type: "output_text",
								text: part.text
							}],
							id: itemId
						});
						break;
					case "tool-call": {
						const toolName = providerOptions?.toolName ?? part.toolName;
						const approvalRequestId = providerOptions?.approvalRequestId;
						if (approvalRequestId) {
							const serverLabel = providerOptions?.serverLabel ?? "";
							input.push({
								type: "mcp_approval_request",
								id: approvalRequestId,
								name: toolName,
								arguments: JSON.stringify(part.input),
								server_label: serverLabel
							});
							break;
						}
						input.push({
							type: "function_call",
							call_id: part.toolCallId,
							name: toolName,
							arguments: JSON.stringify(part.input),
							id: itemId
						});
						const toolCallResult = toolCallResultsByToolCallId[part.toolCallId];
						if (toolCallResult) input.push({
							type: "function_call_output",
							call_id: part.toolCallId,
							output: convertToolResultOutputToString(toolCallResult.output)
						});
						break;
					}
					case "tool-result":
						input.push({
							type: "function_call_output",
							call_id: part.toolCallId,
							output: convertToolResultOutputToString(part.output)
						});
						approvalIdsWithToolResult.add(part.toolCallId);
						break;
					case "reasoning":
						if (!itemId) break;
						input.push({
							type: "reasoning",
							summary: [{
								type: "summary_text",
								text: part.text
							}],
							id: itemId
						});
						break;
				}
			}
			break;
		case "tool":
			for (const part of content) if (part.type === "tool-approval-response") {
				if (processedApprovalIds.has(part.approvalId)) continue;
				processedApprovalIds.add(part.approvalId);
				if (approvalIdsWithToolResult.has(part.approvalId)) continue;
				input.push({
					type: "mcp_approval_response",
					id: part.approvalId,
					approval_request_id: part.approvalId,
					approve: part.approved,
					...part.reason && { reason: part.reason }
				});
			}
			break;
		default: {
			const _exhaustiveCheck = role;
			throw new Error(`Unsupported role: ${String(_exhaustiveCheck)}`);
		}
	}
	return {
		input,
		warnings
	};
}
const ProviderOptionsSchema$1 = z.object({
	itemId: z.string().nullish(),
	toolName: z.string().nullish(),
	serverLabel: z.string().nullish(),
	approvalRequestId: z.string().nullish()
});
const convertToolResultOutputToString = (output) => {
	switch (output.type) {
		case "text":
		case "error-text": return output.value;
		case "execution-denied": return output.reason ?? "Execution denied";
		case "json":
		case "error-json":
		case "content": return JSON.stringify(output.value);
	}
};
/**
* Prepare tools for the Responses API format.
* Unlike the chat completions API, the responses API expects function tools
* with name, description, and parameters at the top level (not nested under 'function').
*/
function prepareResponsesTools({ tools, toolChoice }) {
	if (!tools || tools.length === 0) return {
		tools: void 0,
		toolChoice: void 0
	};
	const responsesTools = [];
	for (const tool of tools) {
		if (tool.type === "provider") continue;
		responsesTools.push({
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema
		});
	}
	if (responsesTools.length === 0) return {
		tools: void 0,
		toolChoice: void 0
	};
	return {
		tools: responsesTools,
		toolChoice: convertResponsesToolChoice(toolChoice)
	};
}
function convertResponsesToolChoice(toolChoice) {
	if (!toolChoice) return void 0;
	switch (toolChoice.type) {
		case "auto": return "auto";
		case "none": return "none";
		case "required": return "required";
		case "tool": return {
			type: "function",
			name: toolChoice.toolName
		};
		default: return;
	}
}
/**
* Converts AI SDK LanguageModelV3CallOptions to Databricks Responses API body parameters.
*
* Inspired by the getArgs method in:
* https://github.com/vercel/ai/blob/main/packages/openai/src/responses/openai-responses-language-model.ts#L118
*
* Complies with the API described in:
* https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference#responses-api-request
*/
function callOptionsToResponsesArgs(options) {
	const warnings = [];
	const databricksOptions = options.providerOptions?.databricks;
	if (options.topK != null) warnings.push({
		type: "unsupported",
		feature: "topK",
		details: "topK is not supported by the Databricks Responses API"
	});
	if (options.presencePenalty != null) warnings.push({
		type: "unsupported",
		feature: "presencePenalty",
		details: "presencePenalty is not supported by the Databricks Responses API"
	});
	if (options.frequencyPenalty != null) warnings.push({
		type: "unsupported",
		feature: "frequencyPenalty",
		details: "frequencyPenalty is not supported by the Databricks Responses API"
	});
	if (options.seed != null) warnings.push({
		type: "unsupported",
		feature: "seed",
		details: "seed is not supported by the Databricks Responses API"
	});
	if (options.stopSequences != null && options.stopSequences.length > 0) warnings.push({
		type: "unsupported",
		feature: "stopSequences",
		details: "stopSequences is not supported by the Databricks Responses API"
	});
	const args = {};
	if (options.maxOutputTokens != null) args.max_output_tokens = options.maxOutputTokens;
	if (options.temperature != null) args.temperature = options.temperature;
	if (options.topP != null) args.top_p = options.topP;
	if (options.responseFormat != null) switch (options.responseFormat.type) {
		case "text":
			args.text = { format: { type: "text" } };
			break;
		case "json":
			if (options.responseFormat.schema != null) args.text = { format: {
				type: "json_schema",
				json_schema: {
					name: options.responseFormat.name ?? "response",
					description: options.responseFormat.description,
					schema: options.responseFormat.schema,
					strict: true
				}
			} };
			else args.text = { format: { type: "json_object" } };
			break;
	}
	if (databricksOptions?.parallelToolCalls != null) args.parallel_tool_calls = databricksOptions.parallelToolCalls;
	if (databricksOptions?.metadata != null) args.metadata = databricksOptions.metadata;
	if (databricksOptions?.reasoning != null) args.reasoning = databricksOptions.reasoning;
	if (databricksOptions?.includeTrace != null) args.databricks_options = { return_trace: databricksOptions.includeTrace };
	return {
		args,
		warnings
	};
}
function mapResponsesFinishReason({ finishReason, hasToolCalls }) {
	let unified;
	switch (finishReason) {
		case void 0:
		case null:
			unified = hasToolCalls ? "tool-calls" : "stop";
			break;
		case "max_output_tokens":
			unified = "length";
			break;
		case "content_filter":
			unified = "content-filter";
			break;
		default: unified = hasToolCalls ? "tool-calls" : "other";
	}
	return {
		raw: finishReason ?? void 0,
		unified
	};
}
var DatabricksResponsesAgentLanguageModel = class {
	specificationVersion = "v3";
	modelId;
	config;
	constructor(modelId, config) {
		this.modelId = modelId;
		this.config = config;
	}
	get provider() {
		return this.config.provider;
	}
	supportedUrls = {};
	async doGenerate(options) {
		const { warnings, ...networkArgs } = await this.getArgs({
			config: this.config,
			options,
			stream: false,
			modelId: this.modelId
		});
		const { value: response } = await postJsonToApi({
			...networkArgs,
			successfulResponseHandler: createJsonResponseHandler(responsesAgentResponseSchema),
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			})
		});
		const content = convertResponsesAgentResponseToMessagePart(response);
		const hasToolCalls = content.some((p) => p.type === "tool-call");
		return {
			content,
			finishReason: mapResponsesFinishReason({
				finishReason: response.incomplete_details?.reason,
				hasToolCalls
			}),
			usage: {
				inputTokens: {
					total: response.usage?.input_tokens ?? 0,
					noCache: 0,
					cacheRead: 0,
					cacheWrite: 0
				},
				outputTokens: {
					total: response.usage?.output_tokens ?? 0,
					text: 0,
					reasoning: 0
				}
			},
			warnings,
			response: { body: response }
		};
	}
	async doStream(options) {
		const { warnings, ...networkArgs } = await this.getArgs({
			config: this.config,
			options,
			stream: true,
			modelId: this.modelId
		});
		const { responseHeaders, value: response } = await postJsonToApi({
			...networkArgs,
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			}),
			successfulResponseHandler: createEventSourceResponseHandler(looseResponseAgentChunkSchema),
			abortSignal: options.abortSignal
		});
		let finishReason = {
			raw: void 0,
			unified: "stop"
		};
		const usage = {
			inputTokens: {
				total: 0,
				noCache: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			outputTokens: {
				total: 0,
				text: 0,
				reasoning: 0
			}
		};
		const allParts = [];
		const useRemoteToolCalling = this.config.useRemoteToolCalling ?? false;
		const toolNamesByCallId = /* @__PURE__ */ new Map();
		return {
			stream: response.pipeThrough(new TransformStream({
				start(controller) {
					controller.enqueue({
						type: "stream-start",
						warnings
					});
				},
				transform(chunk, controller) {
					if (options.includeRawChunks) controller.enqueue({
						type: "raw",
						rawValue: chunk.rawValue
					});
					if (!chunk.success) {
						finishReason = {
							raw: void 0,
							unified: "error"
						};
						controller.enqueue({
							type: "error",
							error: chunk.error
						});
						return;
					}
					if (chunk.value.type === "responses.completed") {
						const hasToolCalls = allParts.some((p) => p.type === "tool-call");
						finishReason = mapResponsesFinishReason({
							finishReason: chunk.value.response.incomplete_details?.reason,
							hasToolCalls
						});
						usage.inputTokens.total = chunk.value.response.usage.input_tokens;
						usage.outputTokens.total = chunk.value.response.usage.output_tokens;
						return;
					}
					if (chunk.value.type === "response.output_item.done" && chunk.value.item.type === "function_call") toolNamesByCallId.set(chunk.value.item.call_id, chunk.value.item.name);
					const parts = convertResponsesAgentChunkToMessagePart(chunk.value, {
						useRemoteToolCalling,
						toolNamesByCallId
					});
					allParts.push(...parts);
					/**
					* Check if the last chunk was a tool result without a tool call
					* This is a special case for MCP approval requests where the tool result
					* is sent in a separate call after the tool call was approved/denied.
					*/
					if (parts.length === 0) return;
					const part = parts[0];
					if (part.type === "tool-result") {
						const matchingToolCallInParts = parts.find((c) => c.type === "tool-call" && c.toolCallId === part.toolCallId);
						const matchingToolCallInStream = allParts.find((c) => c.type === "tool-call" && c.toolCallId === part.toolCallId);
						if (!matchingToolCallInParts && !matchingToolCallInStream) {
							const toolCallFromPreviousMessages = options.prompt.flatMap((message) => {
								if (typeof message.content === "string") return [];
								return message.content.filter((p) => p.type === "tool-call");
							}).find((p) => p.toolCallId === part.toolCallId);
							if (!toolCallFromPreviousMessages) throw new Error("No matching tool call found in previous message");
							controller.enqueue({
								type: "tool-call",
								toolCallId: toolCallFromPreviousMessages.toolCallId,
								toolName: toolCallFromPreviousMessages.toolName,
								input: JSON.stringify(toolCallFromPreviousMessages.input),
								providerExecuted: true,
								dynamic: true
							});
						}
					}
					if (shouldDedupeOutputItemDone(parts, allParts.slice(0, -parts.length))) return;
					for (const part$1 of parts) controller.enqueue(part$1);
				},
				flush(controller) {
					if (!useRemoteToolCalling) {
						const toolCalls = allParts.filter((p) => p.type === "tool-call");
						const toolResults = allParts.filter((p) => p.type === "tool-result");
						for (const toolCall of toolCalls) {
							if (toolCall.providerMetadata?.databricks?.approvalRequestId != null) continue;
							if (!toolResults.some((r) => r.toolCallId === toolCall.toolCallId)) controller.enqueue({
								...toolCall,
								providerExecuted: true,
								dynamic: true
							});
						}
					}
					controller.enqueue({
						type: "finish",
						finishReason,
						usage
					});
				}
			})).pipeThrough(getDatabricksLanguageModelTransformStream()),
			request: { body: networkArgs.body },
			response: { headers: responseHeaders }
		};
	}
	async getArgs({ config, options, stream, modelId }) {
		const { input } = await convertToResponsesInput({
			prompt: options.prompt,
			systemMessageMode: "system"
		});
		const { tools, toolChoice } = prepareResponsesTools({
			tools: options.tools,
			toolChoice: options.toolChoice
		});
		const { args: callArgs, warnings } = callOptionsToResponsesArgs(options);
		return {
			url: config.url({ path: "/responses" }),
			headers: combineHeaders(config.headers(), options.headers),
			body: {
				model: modelId,
				input,
				stream,
				...tools ? { tools } : {},
				...toolChoice && tools ? { tool_choice: toolChoice } : {},
				...callArgs
			},
			warnings,
			fetch: config.fetch
		};
	}
};
function shouldDedupeOutputItemDone(incomingParts, previousParts) {
	const doneTextDelta = incomingParts.find((p) => p.type === "text-delta" && p.providerMetadata?.databricks?.itemType === "response.output_item.done");
	if (!doneTextDelta || doneTextDelta.type !== "text-delta" || !doneTextDelta.id) return false;
	/**
	* To determine if the text in response.output_item.done is a duplicate, we need to reconstruct the text from the
	* previous consecutive text-deltas and check if the .done text is already present in what we've streamed.
	*
	* The caveat is that the response.output_item.done text uses GFM footnote syntax, where as the streamed content
	* uses response.output_text.delta and response.output_text.annotation.added events. So we reconstruct all the
	* delta text and check if the .done text is contained in it (meaning we've already streamed it).
	*
	* We only consider text-deltas that came AFTER the last response.output_item.done event, since each .done
	* corresponds to a specific message and we should only compare against text streamed for that message.
	*/
	const lastDoneIndex = previousParts.findLastIndex((part) => part.type === "text-delta" && part.providerMetadata?.databricks?.itemType === "response.output_item.done");
	const { texts: reconstructuredTexts, current } = previousParts.slice(lastDoneIndex + 1).reduce((acc, part) => {
		if (part.type === "text-delta") return {
			...acc,
			current: acc.current + part.delta
		};
		else if (acc.current.trim().length > 0) return {
			texts: [...acc.texts, acc.current.trim()],
			current: ""
		};
		return acc;
	}, {
		texts: [],
		current: ""
	});
	if (current.length > 0) reconstructuredTexts.push(current);
	if (reconstructuredTexts.length === 0) return false;
	return reconstructuredTexts.reduce((acc, text) => {
		if (!acc.found) return acc;
		const index = doneTextDelta.delta.indexOf(text, acc.lastIndex);
		if (index === -1) return {
			found: false,
			lastIndex: acc.lastIndex
		};
		return {
			found: true,
			lastIndex: index + text.length
		};
	}, {
		found: true,
		lastIndex: 0
	}).found;
}
const toolCallSchema = z.object({
	id: z.string(),
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		arguments: z.string()
	})
});
const reasoningSummarySchema = z.discriminatedUnion("type", [z.object({
	type: z.literal("summary_text"),
	text: z.string(),
	signature: z.string().optional()
}), z.object({
	type: z.literal("summary_encrypted_text"),
	data: z.string()
})]);
const contentItemSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		text: z.string(),
		citation: z.unknown().optional()
	}),
	z.object({
		type: z.literal("image"),
		image_url: z.string()
	}),
	z.object({
		type: z.literal("reasoning"),
		summary: z.array(reasoningSummarySchema)
	})
]);
const toolCallDeltaSchema = z.object({
	index: z.number(),
	id: z.string().optional(),
	type: z.literal("function").optional(),
	function: z.object({
		name: z.string().optional(),
		arguments: z.string().optional()
	}).optional()
});
const fmapiChunkSchema = z.object({
	id: z.string(),
	created: z.number(),
	model: z.string(),
	usage: z.object({
		prompt_tokens: z.number().nullable().optional(),
		completion_tokens: z.number().nullable().optional(),
		total_tokens: z.number().nullable().optional()
	}).nullable().optional(),
	object: z.literal("chat.completion.chunk"),
	choices: z.array(z.object({
		index: z.number(),
		delta: z.object({
			role: z.union([
				z.literal("assistant"),
				z.null(),
				z.undefined()
			]).optional(),
			content: z.union([
				z.string(),
				z.array(contentItemSchema),
				z.null()
			]).optional(),
			tool_calls: z.array(toolCallDeltaSchema).optional()
		}),
		finish_reason: z.union([z.string(), z.null()]).optional()
	}))
});
const fmapiResponseSchema = z.object({
	id: z.string(),
	created: z.number(),
	model: z.string(),
	usage: z.object({
		prompt_tokens: z.number(),
		completion_tokens: z.number(),
		total_tokens: z.number()
	}).nullable().optional(),
	choices: z.array(z.object({
		message: z.object({
			role: z.union([
				z.literal("assistant"),
				z.literal("user"),
				z.literal("tool")
			]),
			content: z.union([
				z.string(),
				z.array(contentItemSchema),
				z.null()
			]).optional(),
			tool_calls: z.array(toolCallSchema).optional()
		}),
		finish_reason: z.union([z.string(), z.null()]).optional()
	}))
});
const convertFmapiChunkToMessagePart = (chunk, toolCallIdsByIndex) => {
	const parts = [];
	if (chunk.choices.length === 0) return parts;
	const choice = chunk.choices[0];
	if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) for (const toolCallDelta of choice.delta.tool_calls) {
		const index = toolCallDelta.index;
		if (toolCallDelta.id && toolCallDelta.function?.name) {
			toolCallIdsByIndex?.set(index, toolCallDelta.id);
			parts.push({
				type: "tool-input-start",
				id: toolCallDelta.id,
				toolName: toolCallDelta.function.name
			});
		}
		if (toolCallDelta.function?.arguments) {
			const id = toolCallDelta.id ?? toolCallIdsByIndex?.get(index) ?? `tool-call-${index}`;
			parts.push({
				type: "tool-input-delta",
				id,
				delta: toolCallDelta.function.arguments
			});
		}
	}
	if (typeof choice.delta.content === "string") {
		if (choice.delta.content) parts.push({
			type: "text-delta",
			id: chunk.id,
			delta: choice.delta.content
		});
	} else if (Array.isArray(choice.delta.content)) parts.push(...mapContentItemsToStreamParts(choice.delta.content, chunk.id));
	return parts;
};
const convertFmapiResponseToMessagePart = (response, options = { useRemoteToolCalling: false }) => {
	const parts = [];
	if (response.choices.length === 0) return parts;
	const choice = response.choices[0];
	if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
		for (const toolCall of choice.message.tool_calls) parts.push(convertToolCallToContent(toolCall, options));
		if (typeof choice.message.content === "string" && choice.message.content) parts.push({
			type: "text",
			text: choice.message.content
		});
		return parts;
	}
	if (typeof choice.message.content === "string") parts.push({
		type: "text",
		text: choice.message.content
	});
	else parts.push(...mapContentItemsToProviderContent(choice.message.content ?? []));
	return parts;
};
const convertToolCallToContent = (toolCall, options) => {
	return {
		type: "tool-call",
		toolCallId: toolCall.id,
		toolName: toolCall.function.name,
		input: toolCall.function.arguments,
		...options.useRemoteToolCalling && {
			dynamic: true,
			providerExecuted: true
		}
	};
};
const mapContentItemsToStreamParts = (items, id) => {
	const parts = [];
	for (const item of items) switch (item.type) {
		case "text":
			parts.push({
				type: "text-delta",
				id,
				delta: item.text
			});
			break;
		case "image": break;
		case "reasoning":
			for (const summary of item.summary.filter((s) => s.type === "summary_text")) parts.push({
				type: "reasoning-delta",
				id,
				delta: summary.text
			});
			break;
	}
	return parts;
};
const mapContentItemsToProviderContent = (items) => {
	const parts = [];
	for (const item of items) switch (item.type) {
		case "text":
			parts.push({
				type: "text",
				text: item.text
			});
			break;
		case "image": break;
		case "reasoning":
			for (const summary of item.summary.filter((s) => s.type === "summary_text")) parts.push({
				type: "reasoning",
				text: summary.text
			});
			break;
	}
	return parts;
};
const convertPromptToFmapiMessages = async (prompt) => {
	const messages = [];
	for (const message of prompt) switch (message.role) {
		case "system":
			messages.push(convertSystemMessage(message));
			break;
		case "user":
			messages.push(convertUserMessage(message));
			break;
		case "assistant":
			messages.push(await convertAssistantMessage(message));
			break;
		case "tool":
			messages.push(...convertToolMessages(message));
			break;
	}
	return { messages };
};
const convertSystemMessage = (message) => {
	return {
		role: "system",
		content: [{
			type: "text",
			text: message.content
		}]
	};
};
const convertUserMessage = (message) => {
	const content = [];
	for (const part of message.content) switch (part.type) {
		case "text":
			content.push({
				type: "text",
				text: part.text
			});
			break;
		case "file":
			if (part.mediaType.startsWith("image/")) {
				const url = toHttpUrlString(part.data);
				if (url) content.push({
					type: "image",
					image_url: url
				});
			}
			break;
	}
	return {
		role: "user",
		content
	};
};
const convertAssistantMessage = async (message) => {
	const contentItems = [];
	const toolCalls = [];
	for (const part of message.content) switch (part.type) {
		case "text":
			contentItems.push({
				type: "text",
				text: part.text
			});
			break;
		case "file":
			if (part.mediaType.startsWith("image/")) {
				const url = toHttpUrlString(part.data);
				if (url) contentItems.push({
					type: "image",
					image_url: url
				});
			}
			break;
		case "reasoning":
			contentItems.push({
				type: "reasoning",
				summary: [{
					type: "summary_text",
					text: part.text
				}]
			});
			break;
		case "tool-call": {
			const toolName = await getToolNameFromPart(part);
			toolCalls.push({
				id: part.toolCallId,
				type: "function",
				function: {
					name: toolName,
					arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input)
				}
			});
			break;
		}
	}
	return {
		role: "assistant",
		content: contentItems.length === 0 ? null : contentItems,
		...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
	};
};
const convertToolMessages = (message) => {
	const messages = [];
	for (const part of message.content) if (part.type === "tool-result") {
		const content = convertToolResultOutputToContentValue(part.output);
		messages.push({
			role: "tool",
			tool_call_id: part.toolCallId,
			content: typeof content === "string" ? content : JSON.stringify(content)
		});
	}
	return messages;
};
const toHttpUrlString = (data) => {
	if (data instanceof URL) return data.toString();
	if (typeof data === "string") {
		if (data.startsWith("http://") || data.startsWith("https://")) return data;
	}
	return null;
};
const convertToolResultOutputToContentValue = (output) => {
	switch (output.type) {
		case "text":
		case "error-text": return output.value;
		case "json":
		case "error-json": return output.value;
		case "content": return output.value;
		default: return null;
	}
};
const ProviderOptionsSchema = z.object({ toolName: z.string().nullish() });
const getToolNameFromPart = async (part) => {
	return (await parseProviderOptions({
		provider: "databricks",
		providerOptions: part.providerOptions,
		schema: ProviderOptionsSchema
	}))?.toolName ?? part.toolName;
};
function mapFmapiFinishReason(finishReason) {
	switch (finishReason) {
		case "stop": return {
			raw: finishReason,
			unified: "stop"
		};
		case "length": return {
			raw: finishReason,
			unified: "length"
		};
		case "content_filter": return {
			raw: finishReason,
			unified: "content-filter"
		};
		case "function_call":
		case "tool_calls": return {
			raw: finishReason,
			unified: "tool-calls"
		};
		default: return {
			raw: finishReason ?? void 0,
			unified: "other"
		};
	}
}
/**
* Converts AI SDK LanguageModelV3CallOptions to Databricks FMAPI body parameters.
*
* Inspired by the getArgs method in:
* https://github.com/vercel/ai/blob/main/packages/openai/src/chat/openai-chat-language-model.ts#L71
*
* Complies with the API described in:
* https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference#chat-request
*/
function callOptionsToFmapiArgs(options) {
	const warnings = [];
	const databricksOptions = options.providerOptions?.databricks;
	if (options.presencePenalty != null) warnings.push({
		type: "unsupported",
		feature: "presencePenalty",
		details: "presencePenalty is not supported by the Databricks FMAPI"
	});
	if (options.frequencyPenalty != null) warnings.push({
		type: "unsupported",
		feature: "frequencyPenalty",
		details: "frequencyPenalty is not supported by the Databricks FMAPI"
	});
	if (options.seed != null) warnings.push({
		type: "unsupported",
		feature: "seed",
		details: "seed is not supported by the Databricks FMAPI"
	});
	const args = {};
	if (options.maxOutputTokens != null) args.max_tokens = options.maxOutputTokens;
	if (options.temperature != null) args.temperature = options.temperature;
	if (options.topP != null) args.top_p = options.topP;
	if (options.topK != null) args.top_k = options.topK;
	if (options.stopSequences != null && options.stopSequences.length > 0) args.stop = options.stopSequences;
	if (options.responseFormat != null) switch (options.responseFormat.type) {
		case "text":
			args.response_format = { type: "text" };
			break;
		case "json":
			if (options.responseFormat.schema != null) args.response_format = {
				type: "json_schema",
				json_schema: {
					name: options.responseFormat.name ?? "response",
					description: options.responseFormat.description,
					schema: options.responseFormat.schema,
					strict: true
				}
			};
			else args.response_format = { type: "json_object" };
			break;
	}
	if (databricksOptions?.topK != null) args.top_k = databricksOptions.topK;
	if (databricksOptions?.n != null) args.n = databricksOptions.n;
	if (databricksOptions?.logprobs != null) args.logprobs = databricksOptions.logprobs;
	if (databricksOptions?.topLogprobs != null) args.top_logprobs = databricksOptions.topLogprobs;
	if (databricksOptions?.reasoningEffort != null) args.reasoning_effort = databricksOptions.reasoningEffort;
	return {
		args,
		warnings
	};
}
var DatabricksFmapiLanguageModel = class {
	specificationVersion = "v3";
	modelId;
	config;
	constructor(modelId, config) {
		this.modelId = modelId;
		this.config = config;
	}
	get provider() {
		return this.config.provider;
	}
	supportedUrls = {};
	async doGenerate(options) {
		const { warnings, ...networkArgs } = await this.getArgs({
			config: this.config,
			options,
			stream: false,
			modelId: this.modelId
		});
		const { value: response } = await postJsonToApi({
			...networkArgs,
			successfulResponseHandler: createJsonResponseHandler(fmapiResponseSchema),
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			})
		});
		const choice = response.choices[0];
		const finishReason = mapFmapiFinishReason(choice?.finish_reason);
		return {
			content: convertFmapiResponseToMessagePart(response, { useRemoteToolCalling: this.config.useRemoteToolCalling ?? false }),
			finishReason,
			usage: {
				inputTokens: {
					total: response.usage?.prompt_tokens ?? 0,
					noCache: 0,
					cacheRead: 0,
					cacheWrite: 0
				},
				outputTokens: {
					total: response.usage?.completion_tokens ?? 0,
					text: 0,
					reasoning: 0
				}
			},
			warnings
		};
	}
	async doStream(options) {
		const { warnings, ...networkArgs } = await this.getArgs({
			config: this.config,
			options,
			stream: true,
			modelId: this.modelId
		});
		const { responseHeaders, value: response } = await postJsonToApi({
			...networkArgs,
			failedResponseHandler: createJsonErrorResponseHandler({
				errorSchema: z.any(),
				errorToMessage: (error) => JSON.stringify(error),
				isRetryable: () => false
			}),
			successfulResponseHandler: createEventSourceResponseHandler(fmapiChunkSchema),
			abortSignal: options.abortSignal
		});
		let finishReason = {
			raw: void 0,
			unified: "other"
		};
		let usage = {
			inputTokens: {
				total: 0,
				noCache: 0,
				cacheRead: 0,
				cacheWrite: 0
			},
			outputTokens: {
				total: 0,
				text: 0,
				reasoning: 0
			}
		};
		const toolCallIdsByIndex = /* @__PURE__ */ new Map();
		const toolCallNamesById = /* @__PURE__ */ new Map();
		const toolCallInputsById = /* @__PURE__ */ new Map();
		const useRemoteToolCalling = this.config.useRemoteToolCalling ?? false;
		return {
			stream: response.pipeThrough(new TransformStream({
				start(controller) {
					controller.enqueue({
						type: "stream-start",
						warnings
					});
				},
				transform(chunk, controller) {
					if (options.includeRawChunks) controller.enqueue({
						type: "raw",
						rawValue: chunk.rawValue
					});
					if (!chunk.success) {
						finishReason = {
							raw: void 0,
							unified: "error"
						};
						controller.enqueue({
							type: "error",
							error: chunk.error
						});
						return;
					}
					const choice = chunk.value.choices[0];
					finishReason = mapFmapiFinishReason(choice?.finish_reason);
					if (chunk.value.usage) usage = {
						inputTokens: {
							total: chunk.value.usage.prompt_tokens ?? 0,
							noCache: 0,
							cacheRead: 0,
							cacheWrite: 0
						},
						outputTokens: {
							total: chunk.value.usage.completion_tokens ?? 0,
							text: 0,
							reasoning: 0
						}
					};
					const parts = convertFmapiChunkToMessagePart(chunk.value, toolCallIdsByIndex);
					for (const part of parts) {
						if (part.type === "tool-input-start") {
							toolCallNamesById.set(part.id, part.toolName);
							toolCallInputsById.set(part.id, "");
						} else if (part.type === "tool-input-delta") {
							const current = toolCallInputsById.get(part.id) ?? "";
							toolCallInputsById.set(part.id, current + part.delta);
						}
						controller.enqueue(part);
					}
				},
				flush(controller) {
					for (const [toolCallId, inputText] of toolCallInputsById) {
						const toolName = toolCallNamesById.get(toolCallId);
						if (toolName) {
							controller.enqueue({
								type: "tool-input-end",
								id: toolCallId
							});
							controller.enqueue({
								type: "tool-call",
								toolCallId,
								toolName,
								input: inputText,
								...useRemoteToolCalling && {
									dynamic: true,
									providerExecuted: true
								}
							});
						}
					}
					controller.enqueue({
						type: "finish",
						finishReason,
						usage
					});
				}
			})).pipeThrough(getDatabricksLanguageModelTransformStream()),
			request: { body: networkArgs.body },
			response: { headers: responseHeaders }
		};
	}
	async getArgs({ config, options, stream, modelId }) {
		const tools = options.tools?.map((tool) => convertToolToOpenAIFormat(tool)).filter((tool) => tool !== void 0);
		const toolChoice = options.toolChoice ? convertToolChoiceToOpenAIFormat(options.toolChoice) : void 0;
		const { messages } = await convertPromptToFmapiMessages(options.prompt);
		const { args: callArgs, warnings } = callOptionsToFmapiArgs(options);
		return {
			url: config.url({ path: "/chat/completions" }),
			headers: combineHeaders(config.headers(), options.headers),
			body: {
				messages,
				stream,
				model: modelId,
				...tools && tools.length > 0 ? { tools } : {},
				...toolChoice && tools && tools.length > 0 ? { tool_choice: toolChoice } : {},
				...callArgs
			},
			warnings,
			fetch: config.fetch
		};
	}
};
/**
* Convert AI SDK tool to OpenAI format
*/
function convertToolToOpenAIFormat(tool) {
	if (tool.type === "provider") return void 0;
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema
		}
	};
}
/**
* Convert AI SDK tool choice to OpenAI format
*/
function convertToolChoiceToOpenAIFormat(toolChoice) {
	if (toolChoice.type === "auto") return "auto";
	if (toolChoice.type === "none") return "none";
	if (toolChoice.type === "required") return "required";
	if (toolChoice.type === "tool") return {
		type: "function",
		function: { name: toolChoice.toolName }
	};
	return "auto";
}
const createDatabricksProvider = (settings) => {
	const baseUrl = withoutTrailingSlash(settings.baseURL);
	const getHeaders = () => combineHeaders(settings.headers);
	const fetch$1 = settings.fetch;
	const provider = settings.provider ?? "databricks";
	const formatUrl = ({ path }) => settings.formatUrl?.({
		baseUrl,
		path
	}) ?? `${baseUrl}${path}`;
	const createChatAgent = (modelId) => new DatabricksChatAgentLanguageModel(modelId, {
		url: formatUrl,
		headers: getHeaders,
		fetch: fetch$1,
		provider
	});
	const createResponsesAgent = (modelId) => new DatabricksResponsesAgentLanguageModel(modelId, {
		url: formatUrl,
		headers: getHeaders,
		fetch: fetch$1,
		provider,
		useRemoteToolCalling: settings.useRemoteToolCalling
	});
	const createFmapi = (modelId) => new DatabricksFmapiLanguageModel(modelId, {
		url: formatUrl,
		headers: getHeaders,
		fetch: fetch$1,
		provider,
		useRemoteToolCalling: settings.useRemoteToolCalling
	});
	const notImplemented = (name$2) => {
		return () => {
			throw new Error(`${name$2} is not supported yet`);
		};
	};
	return {
		specificationVersion: "v3",
		responses: createResponsesAgent,
		chatCompletions: createFmapi,
		chatAgent: createChatAgent,
		imageModel: notImplemented("ImageModel"),
		textEmbeddingModel: notImplemented("TextEmbeddingModel"),
		embeddingModel: notImplemented("EmbeddingModel"),
		languageModel: notImplemented("LanguageModel")
	};
};

//#endregion
//#region ../packages/ai-sdk-providers/src/request-context.ts
/**
* Utility functions for request context handling.
*/
/**
* Determines whether context should be injected based on endpoint type.
*
* Context is injected when:
* 1. Using API_PROXY environment variable, OR
* 2. Endpoint task type is 'agent/v2/chat' or 'agent/v1/responses'
*
* @param endpointTask - The task type of the serving endpoint (optional)
* @returns Whether to inject context into requests
*/
function shouldInjectContextForEndpoint(endpointTask) {
	if (process.env.API_PROXY) return true;
	return endpointTask === "agent/v2/chat" || endpointTask === "agent/v1/responses";
}

//#endregion
//#region ../packages/ai-sdk-providers/src/providers-server.ts
const CONTEXT_HEADER_CONVERSATION_ID = "x-databricks-conversation-id";
const CONTEXT_HEADER_USER_ID = "x-databricks-user-id";
async function getProviderToken() {
	if (API_PROXY) return "";
	if (process.env.DATABRICKS_TOKEN) {
		console.log("Using PAT token from DATABRICKS_TOKEN env var");
		return process.env.DATABRICKS_TOKEN;
	}
	return getDatabricksToken();
}
let cachedWorkspaceHostname = null;
async function getWorkspaceHostname() {
	if (API_PROXY) return "http://localhost";
	if (cachedWorkspaceHostname) return cachedWorkspaceHostname;
	try {
		if (getAuthMethod() === "cli") {
			await getDatabricksUserIdentity();
			const cliHost = getCachedCliHost();
			if (cliHost) {
				cachedWorkspaceHostname = cliHost;
				return cachedWorkspaceHostname;
			} else throw new Error("CLI authentication succeeded but hostname was not cached");
		} else {
			cachedWorkspaceHostname = getHostUrl();
			return cachedWorkspaceHostname;
		}
	} catch (error) {
		throw new Error(`Unable to determine Databricks workspace hostname: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}
const LOG_SSE_EVENTS = process.env.LOG_SSE_EVENTS === "true";
const API_PROXY = process.env.API_PROXY;
const endpointDetailsCache = /* @__PURE__ */ new Map();
const ENDPOINT_DETAILS_CACHE_DURATION = 300 * 1e3;
/**
* Checks if context should be injected based on cached endpoint details.
* Returns true if API_PROXY is set or if the endpoint task type is agent/v2/chat or agent/v1/responses.
*/
function shouldInjectContext() {
	const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
	if (!servingEndpoint) return Boolean(API_PROXY);
	const endpointTask = endpointDetailsCache.get(servingEndpoint)?.task;
	return shouldInjectContextForEndpoint(endpointTask);
}
const databricksFetch = async (input, init) => {
	const url = input.toString();
	let requestInit = init;
	const headers = new Headers(requestInit?.headers);
	const conversationId = headers.get(CONTEXT_HEADER_CONVERSATION_ID);
	const userId = headers.get(CONTEXT_HEADER_USER_ID);
	headers.delete(CONTEXT_HEADER_CONVERSATION_ID);
	headers.delete(CONTEXT_HEADER_USER_ID);
	requestInit = {
		...requestInit,
		headers
	};
	if (conversationId && userId && requestInit?.body && typeof requestInit.body === "string") {
		if (shouldInjectContext()) try {
			const body = JSON.parse(requestInit.body);
			const enhancedBody = {
				...body,
				context: {
					...body.context,
					conversation_id: conversationId,
					user_id: userId
				}
			};
			requestInit = {
				...requestInit,
				body: JSON.stringify(enhancedBody)
			};
		} catch {}
	}
	if (requestInit?.body) try {
		const requestBody = typeof requestInit.body === "string" ? JSON.parse(requestInit.body) : requestInit.body;
		console.log("Databricks request:", JSON.stringify({
			url,
			method: requestInit.method || "POST",
			body: requestBody
		}));
	} catch (_e) {
		console.log("Databricks request (raw):", {
			url,
			method: requestInit.method || "POST",
			body: requestInit.body
		});
	}
	const response = await fetch(url, requestInit);
	if (LOG_SSE_EVENTS && response.body) {
		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson")) {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let eventCounter = 0;
			const loggingStream = new ReadableStream({
				async pull(controller) {
					const { done, value } = await reader.read();
					if (done) {
						console.log("[SSE] Stream ended");
						controller.close();
						return;
					}
					const lines = decoder.decode(value, { stream: true }).split("\n").filter((line) => line.trim());
					for (const line of lines) {
						eventCounter++;
						if (line.startsWith("data:")) {
							const data = line.slice(5).trim();
							try {
								const parsed = JSON.parse(data);
								console.log(`[SSE #${eventCounter}]`, JSON.stringify(parsed));
							} catch {
								console.log(`[SSE #${eventCounter}] (raw)`, data);
							}
						} else if (line.trim()) console.log(`[SSE #${eventCounter}] (line)`, line);
					}
					controller.enqueue(value);
				},
				cancel() {
					reader.cancel();
				}
			});
			return new Response(loggingStream, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		}
	}
	return response;
};
let oauthProviderCache = null;
let oauthProviderCacheTime = 0;
const PROVIDER_CACHE_DURATION = 300 * 1e3;
async function getOrCreateDatabricksProvider() {
	if (oauthProviderCache && Date.now() - oauthProviderCacheTime < PROVIDER_CACHE_DURATION) {
		console.log("Using cached OAuth provider");
		return oauthProviderCache;
	}
	console.log("Creating new OAuth provider");
	const provider = createDatabricksProvider({
		useRemoteToolCalling: true,
		baseURL: `${await getWorkspaceHostname()}/serving-endpoints`,
		formatUrl: ({ baseUrl, path }) => API_PROXY ?? `${baseUrl}${path}`,
		fetch: async (...[input, init]) => {
			const headers = new Headers(init?.headers);
			const userToken = headers.get("x-forwarded-access-token");
			if (userToken) headers.set("Authorization", `Bearer ${userToken}`);
			else if (!API_PROXY) {
				const currentToken = await getProviderToken();
				headers.set("Authorization", `Bearer ${currentToken}`);
			}
			if (API_PROXY) headers.set("x-mlflow-return-trace-id", "true");
			return databricksFetch(input, {
				...init,
				headers
			});
		}
	});
	oauthProviderCache = provider;
	oauthProviderCacheTime = Date.now();
	return provider;
}
const getEndpointDetails = async (servingEndpoint) => {
	const cached = endpointDetailsCache.get(servingEndpoint);
	if (cached && Date.now() - cached.timestamp < ENDPOINT_DETAILS_CACHE_DURATION) return cached;
	const currentToken = await getProviderToken();
	const hostname = await getWorkspaceHostname();
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${currentToken}`);
	const data = await (await databricksFetch(`${hostname}/api/2.0/serving-endpoints/${servingEndpoint}`, {
		method: "GET",
		headers
	})).json();
	const isSupervisorAgent = data.tile_endpoint_metadata?.problem_type === "MULTI_AGENT_SUPERVISOR";
	const userApiScopes = data.auth_policy?.user_auth_policy?.api_scopes ?? [];
	const isOboEnabled = userApiScopes.length > 0 || isSupervisorAgent;
	if (isOboEnabled && !userApiScopes.includes("serving.serving-endpoints")) userApiScopes.push("serving.serving-endpoints");
	if (isOboEnabled) console.warn(`⚠ OBO detected on endpoint "${servingEndpoint}". Required user authorization scopes: ${JSON.stringify(userApiScopes)}\n  → Add scopes to your app via the Databricks UI or in databricks.yml\n  → See: https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#enable-user-authorization`);
	const returnValue = {
		task: data.task,
		userApiScopes,
		isOboEnabled,
		timestamp: Date.now()
	};
	endpointDetailsCache.set(servingEndpoint, returnValue);
	return returnValue;
};
/**
* Returns OBO info for the configured serving endpoint.
* Detects OBO via auth_policy scopes or Supervisor Agent type.
*/
async function getEndpointOboInfo() {
	const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
	if (!servingEndpoint) return {
		isEndpointOboEnabled: false,
		endpointRequiredScopes: []
	};
	try {
		const details = await getEndpointDetails(servingEndpoint);
		return {
			isEndpointOboEnabled: details.isOboEnabled,
			endpointRequiredScopes: details.userApiScopes
		};
	} catch {
		return {
			isEndpointOboEnabled: false,
			endpointRequiredScopes: []
		};
	}
}
var OAuthAwareProvider = class {
	modelCache = /* @__PURE__ */ new Map();
	CACHE_DURATION = 300 * 1e3;
	async languageModel(id) {
		const cached = this.modelCache.get(id);
		if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
			console.log(`Using cached model for ${id}`);
			return cached.model;
		}
		const provider = await getOrCreateDatabricksProvider();
		const wrappedModel = wrapLanguageModel({
			model: await (async () => {
				if (API_PROXY) return provider.responses(id);
				if (id === "title-model" || id === "artifact-model") return provider.chatCompletions("databricks-meta-llama-3-3-70b-instruct");
				if (!process.env.DATABRICKS_SERVING_ENDPOINT) throw new Error("Please set the DATABRICKS_SERVING_ENDPOINT environment variable to the name of an agent serving endpoint");
				const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
				const endpointDetails = await getEndpointDetails(servingEndpoint);
				console.log(`Creating fresh model for ${id}`);
				switch (endpointDetails.task) {
					case "agent/v2/chat": return provider.chatAgent(servingEndpoint);
					case "agent/v1/responses":
					case "agent/v2/responses": return provider.responses(servingEndpoint);
					case "llm/v1/chat": return provider.chatCompletions(servingEndpoint);
					default: return provider.responses(servingEndpoint);
				}
			})(),
			middleware: [extractReasoningMiddleware({ tagName: "think" })]
		});
		this.modelCache.set(id, {
			model: wrappedModel,
			timestamp: Date.now()
		});
		return wrappedModel;
	}
};
const providerInstance = new OAuthAwareProvider();
function getDatabricksServerProvider() {
	return providerInstance;
}

//#endregion
export { getDatabricksServerProvider as a, shouldInjectContextForEndpoint as c, databricksFetch as i, CONTEXT_HEADER_USER_ID as n, getEndpointOboInfo as o, OAuthAwareProvider as r, getWorkspaceHostname as s, CONTEXT_HEADER_CONVERSATION_ID as t };