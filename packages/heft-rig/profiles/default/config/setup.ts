// Via the workspace alias: a dependency would be a cycle (nucleus-test →
// nucleus-dom → heft-rig). Vite loads setup files only from inside the
// package root, where this file is linked; imports it follows are exempt.
import "@excom/nucleus-test/setup";
