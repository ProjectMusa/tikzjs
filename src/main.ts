import { SyntaxError, parse } from "./tikzjs";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

console.log(parse("1+1", {}));

const argv = yargs(hideBin(process.argv))
  .option("port", {
    alias: "p",
    describe: "Port to bind on",
    default: 7200,
    number: true,
  })
  .option("worker", {
    alias: "w",
    describe: "Number of workers",
    default: 4,
    number: true,
  })
  .parseSync();
