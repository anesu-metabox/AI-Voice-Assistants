const major = Number(process.versions.node.split(".")[0]);

if (!Number.isInteger(major) || major < 24) {
  console.error("The 3CX connector requires Node.js >=24.0.0.");
  process.exitCode = 1;
}
