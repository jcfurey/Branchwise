import path from "node:path";

// Git processes started by tests, including those the code under test starts, read only this
// global configuration. CI sets NGG_HOSTILE_GIT_CONFIG to use settings that change Git's output.
process.env["GIT_CONFIG_GLOBAL"] = path.resolve(
  __dirname,
  "fixtures",
  process.env["NGG_HOSTILE_GIT_CONFIG"] === "1" ? "hostile.gitconfig" : "gitconfig"
);
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
