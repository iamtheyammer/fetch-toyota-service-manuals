import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";

export interface CLIArgs {
  manual: string[];
  email: string;
  password: string;
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
            "{bold Required.} Manual ID(s) to download. Use multiple times for multiple manuals.",
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
          name: "help",
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

    if (!options.manual || !options.email || !options.password) {
      console.error("Missing required args!");
      // console.log(options);

      console.log(usage);
      process.exit(1);
    }
    return {
      manual: options.manual,
      email: options.email,
      password: options.password,
    };
  } catch (e: any) {
    console.error(e);
    console.log(usage);
    process.exit(1);
  }
}
