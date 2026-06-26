import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";

export interface CLIArgs {
  manual: string[];
  email: string;
  password: string;
  headed: boolean;
  cookieString?: string;
}

export default function processCLIArgs(): CLIArgs {
  const optionConfig = [
    {
      name: "manual",
      alias: "m",
      type: String,
      multiple: true,
    },
    {
      name: "email",
      alias: "e",
      type: String,
    },
    {
      name: "password",
      alias: "p",
      type: String,
    },
    {
      name: "headed",
      alias: "h",
      type: Boolean,
      defaultOption: false,
    },
    {
      name: "cookie-string",
      alias: "c",
      type: String,
    },
    {
      name: "help",
      type: Boolean,
    },
  ];

  const sections = [
    {
      header: "Toyota/Lexus/Scion Workshop Manual Downloader",
      content:
        "Download the full workshop manual for your car. Must have a valid TIS subscription.",
    },
    {
      header: "Options",
      optionList: [
        {
          name: "manual -m",
          typeLabel: "{underline RM12345}",
          description:
            "{bold Required.} Manual ID(s) to download. Use multiple times for multiple manuals. For non-electrical manuals, add @YEAR to the end to only download pages for that year.",
        },
        {
          name: "email -e",
          typeLabel: "{underline me@example.com}",
          description: "{bold Required.} Your TIS email.",
        },
        {
          name: "password -p",
          typeLabel: "{underline abc1234}",
          description: "{bold Required.} Your TIS password.",
        },
        {
          name: "cookie-string -c",
          typeLabel: "{underline abc1234}",
          description:
            "Your TIS cookie string. If you don't know what this is, don't use it.",
        },
        {
          name: "headed -h",
          typeLabel: " ",
          description: "Run in headed mode (show the emulated browser).",
        },
        {
          name: "help",
          typeLabel: " ",
          description: "Print this usage guide.",
        },
      ],
    },
  ];

  const usage = commandLineUsage(sections);

  try {
    const options = commandLineArgs(optionConfig);
    if (options.help) {
      console.log(usage);
      process.exit(0);
    }

    // Resolve each credential from its CLI flag, falling back to the matching
    // env var, then validate -- so any valid mix (e.g. CLI email + env
    // password) is accepted consistently with how it is used.
    const email = options.email || process.env.TIS_EMAIL;
    const password = options.password || process.env.TIS_PASSWORD;
    const cookieString = options["cookie-string"] || process.env.TIS_COOKIE;

    if (!options.manual || ((!email || !password) && !cookieString)) {
      console.error("Missing required args!");
      console.log(usage);
      process.exit(1);
    }
    return {
      manual: options.manual,
      email,
      password,
      headed: options.headed,
      cookieString,
    };
  } catch (e: any) {
    console.error(e);
    console.log(usage);
    process.exit(1);
  }
}
