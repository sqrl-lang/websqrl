import Head from "next/head";
import dynamic from "next/dynamic";

import { useEffect, useState, useRef } from "react";

import { sprintf } from "sprintf-js";
import SAMPLE from "../src/sample.sqrl";
import Split from "react-split";
import { invariant } from "../src/invariant";
import Worker from "worker-loader!../workers/compile.worker";
import {
  addMinutes,
  subMilliseconds,
  startOfMinute,
  differenceInMilliseconds,
} from "date-fns";
import { Request, Response, WikiEvent, Result } from "../src/types";

const MonacoEditor = dynamic(import("react-monaco-editor"), { ssr: false });

let LOG_ID = 0;
const DELAY_MS = 60_000 * 3;

export default function Home() {
  const worker = useRef<Worker>();
  const lastSource = useRef<string>(null);
  const logs = useRef<JSX.Element[]>([]);

  const [, setLogId] = useState(LOG_ID);
  const [source, setSource] = useState(SAMPLE);

  function recompile() {
    clearLog("Compiling...");
    lastSource.current = source;
    req({ type: "compile", source });
  }

  if (lastSource.current !== source && worker.current) {
    recompile();
  }

  function req(request: Request) {
    worker.current.postMessage(request);
  }

  function clearLog(message: string) {
    logs.current = [<div key={LOG_ID++}>{message}</div>];
    setLogId(LOG_ID);
  }

  function append(entry: JSX.Element) {
    // @todo: This is an extremely hacky way to do logs
    if (logs.current.length > 150) {
      logs.current.shift();
    }
    logs.current.push(<div key={LOG_ID++}>{entry}</div>);
    setLogId(LOG_ID);
  }

  function buildEntry(res: Result) {
    const messages = [];
    for (const msg of res.logs) {
      messages.push(sprintf(msg.format, ...msg.args));
    }
    return <div>{messages}</div>;
  }
  useEffect(() => {
    const scripts: HTMLScriptElement[] = [];

    function startDownload(date: Date) {
      const filename = date
        .toISOString()
        .substring(0, "0000-00-00T00:00".length);
      const script = document.createElement("script");
      script.src = `https://sqrl-aws-diffs.s3.amazonaws.com/v1/en.wikipedia.org/${filename}.js`;
      script.async = true;
      document.body.appendChild(script);
      scripts.push(script);
    }

    let events: WikiEvent[] = [];
    let eventIndex = 0;
    let nextEventTimeout: NodeJS.Timeout;
    let downloadDate = startOfMinute(subMilliseconds(new Date(), DELAY_MS));
    let firstBatch = true;

    function nextEvent() {
      if (eventIndex < events.length) {
        req({
          type: "event",
          event: events[eventIndex],
        });
        eventIndex++;
      } else {
        const nextDownload = addMinutes(downloadDate, 1);
        if (delayedMsUntil(nextDownload) <= 0) {
          downloadDate = nextDownload;
          startDownload(downloadDate);
        }
      }
      scheduleNextEvent();
    }

    function delayedMsUntil(nextEventDate: Date) {
      const now = subMilliseconds(new Date(), DELAY_MS);
      return differenceInMilliseconds(nextEventDate, now);
    }

    function scheduleNextEvent() {
      let nextEventDate: Date;
      if (eventIndex < events.length) {
        nextEventDate = new Date(events[eventIndex].meta.dt);
      } else {
        nextEventDate = addMinutes(downloadDate, 1);
      }
      clearTimeout(nextEventTimeout);
      nextEventTimeout = setTimeout(
        nextEvent,
        Math.max(10, delayedMsUntil(nextEventDate))
      );
    }

    (window as any).wikiData = (data: {
      version: string;
      timestamp: string;
      events: any[];
    }) => {
      events = data.events;
      eventIndex = 0;
      if (firstBatch) {
        while (eventIndex < events.length) {
          const eventDate = new Date(events[eventIndex].meta.dt);
          if (delayedMsUntil(eventDate) > 0) {
            break;
          }
          eventIndex++;
        }
        firstBatch = false;
      }
      console.log("Got", events.length, "in batch, starting from", eventIndex);
      scheduleNextEvent();
    };

    startDownload(downloadDate);

    return () => {
      clearTimeout(nextEventTimeout);
      scripts.forEach((script) => {
        document.body.removeChild(script);
      });
    };
  });

  useEffect(() => {
    invariant(!worker.current, "Worker created twice");
    worker.current = new Worker();
    worker.current.onmessage = (event) => {
      const res = event.data as Response;
      if (res.type === "compileOkay") {
        if (res.source === lastSource.current) {
          clearLog("Compiled! Running...");
        }
      } else if (res.type === "compileError") {
        if (res.source === lastSource.current) {
          clearLog(res.message);
        }
      } else if (res.type === "runtimeError") {
        if (res.source === lastSource.current) {
          clearLog("Error during execution\n\n" + res.message);
        }
      } else if (res.type === "result") {
        try {
          append(buildEntry(res));
        } catch (err) {
          append(
            <div>
              <h2>Error rendering result</h2>
              <div>{err.stack}</div>
            </div>
          );
        }
      } else {
        console.log("Unknown webworker message:", res);
      }
    };
    recompile();

    return () => {
      worker.current.terminate();
      worker.current = null;
    };
  }, []);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
      }}
    >
      <Head>
        <title>SQRL Wikipedia Demo</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Split
        direction="horizontal"
        elementStyle={(dimension, size, gutterSize) => ({
          "flex-basis": `calc(${size}% - ${gutterSize}px)`,
        })}
        gutterStyle={(dimension, gutterSize) => ({
          "flex-basis": `${gutterSize}px`,
          cursor: "ew-resize",
        })}
        style={{ width: "100%", height: "100%", display: "flex" }}
      >
        <div>
          <MonacoEditor
            value={source}
            onChange={setSource}
            language="cpp"
            theme="vs-dark"
            editorDidMount={() => {
              (window as any).MonacoEnvironment.getWorkerUrl = (
                moduleId,
                label
              ) => {
                if (label === "json") return "_next/static/json.worker.js";
                if (label === "css") return "_next/static/css.worker.js";
                if (label === "html") return "_next/static/html.worker.js";
                if (label === "typescript" || label === "javascript")
                  return "_next/static/ts.worker.js";
                return "_next/static/editor.worker.js";
              };
            }}
          />
        </div>

        <div
          style={{
            paddingTop: "5px",
            height: "100%",
            overflow: "auto",
            backgroundColor: "#111",
          }}
        >
          <div
            id="compileOutput"
            style={{
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              padding: "5px",
              color: "#fff",
              height: "100%",
            }}
          >
            {logs.current}
          </div>
        </div>
      </Split>
    </main>
  );
}
