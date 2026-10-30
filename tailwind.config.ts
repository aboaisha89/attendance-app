import type { Config } from "tailwindcss";
const config: Config = { content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { forest: "#064E3B", mint: "#DCFCE7" }, boxShadow: { soft: "0 8px 30px rgba(15, 23, 42, .06)" } } }, plugins: [] };
export default config;
