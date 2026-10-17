/**
 * QuireNote 插件「酒馆兼容」。笔记本本体只认 Quire 卡；启用这个插件后，可以导入 SillyTavern 的角色卡、
 * 世界书、正则脚本和对话预设，并把知识书、预设导出回酒馆格式。
 */
export * from "./convert";
export { PLUGIN_ID, sillytavernImporter } from "./importer";
export { type StMessages, stMessages } from "./messages";
