import streamDeck from "@elgato/streamdeck";
import {
  Act11, Agent1, Agent2, Agent3, Agent4, Agent5, Agent6,
  Approve, Back, Decline, Dictation, Fast, Fork, Forward, NewTask,
  KeycapAddFiles, KeycapAddPhotos, KeycapApprove, KeycapArchive, KeycapBranch, KeycapBrowser,
  KeycapBug, KeycapCodex, KeycapCreateBranch, KeycapDiff, KeycapDownload, KeycapGitCommit, KeycapLab,
  KeycapFast,
  KeycapMerge, KeycapMic, KeycapMicSingle, KeycapNewTask, KeycapOpenAiDocs, KeycapOpenFolder, KeycapPin, KeycapPlay,
  KeycapPullRequest, KeycapReasoningDown, KeycapReasoningUp, KeycapReject, KeycapSettings,
  KeycapSideChat, KeycapSkills, KeycapSplit, KeycapTasks, KeycapTerminal, KeycapYolo, KeycapYeet,
  Plan, RateLimitReset, Reasoning, ReasoningDown, ReasoningUp, Send, Sidebar,
  UsageLimit, UsageOverview, SideToMainAction, GlobalDictationAction, ContextCompactionAction
} from "./actions.js";
import { DeckController } from "./controller.js";
import { PlusAgentsDial, PlusConversationDial, PlusReasoningDial, PlusCommandsDial, PlusUsageDial, PlusModelDial } from "./plus-actions.js";
import { bridgeFailureCode } from "./bridge-error.js";
import { releaseOnDeviceDisconnect } from "./device-disconnect.js";
import { globalDictationHold } from './global-dictation.js';

const controller = new DeckController();

streamDeck.devices.onDeviceDidDisconnect(() => {
  void releaseOnDeviceDisconnect(controller, globalDictationHold, streamDeck.logger);
});

streamDeck.settings.onDidReceiveGlobalSettings<{ showContextRings?: boolean }>((event) => {
  controller.setContextRingVisibility(event.settings.showContextRings !== false);
});

for (const pluginAction of [
  new Agent1(controller), new Agent2(controller), new Agent3(controller),
  new Agent4(controller), new Agent5(controller), new Agent6(controller),
  new Fast(controller), new Approve(controller), new Decline(controller),
  new Fork(controller), new Dictation(controller), new Act11(controller), new Send(controller),
  new Plan(controller), new Reasoning(controller), new ReasoningDown(controller),
  new ReasoningUp(controller), new NewTask(controller),
  new UsageLimit(controller), new UsageOverview(controller), new RateLimitReset(controller),
  new ContextCompactionAction(controller),
  new SideToMainAction(controller),
  new GlobalDictationAction(controller),
  new Back(controller), new Forward(controller), new Sidebar(controller),
  new KeycapFast(controller), new KeycapApprove(controller), new KeycapReject(controller),
  new KeycapSplit(controller), new KeycapMic(controller), new KeycapMicSingle(controller),
  new KeycapNewTask(controller), new KeycapReasoningUp(controller),
  new KeycapReasoningDown(controller), new KeycapCodex(controller), new KeycapBug(controller),
  new KeycapOpenAiDocs(controller), new KeycapTerminal(controller), new KeycapDownload(controller),
  new KeycapArchive(controller), new KeycapBrowser(controller), new KeycapPin(controller),
  new KeycapDiff(controller), new KeycapPlay(controller), new KeycapGitCommit(controller),
  new KeycapBranch(controller), new KeycapCreateBranch(controller), new KeycapMerge(controller), new KeycapPullRequest(controller),
  new KeycapAddPhotos(controller), new KeycapLab(controller), new KeycapSideChat(controller),
  new KeycapTasks(controller), new KeycapSettings(controller), new KeycapOpenFolder(controller),
  new KeycapAddFiles(controller), new KeycapSkills(controller),
  new KeycapYolo(controller), new KeycapYeet(controller),
  new PlusAgentsDial(controller), new PlusReasoningDial(controller), new PlusConversationDial(controller), new PlusCommandsDial(controller), new PlusUsageDial(controller), new PlusModelDial(controller)
]) streamDeck.actions.registerAction(pluginAction);

streamDeck.connect();
void controller.start().catch((error) => streamDeck.logger.error(`Codex connection failed: ${bridgeFailureCode(error)}`));

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void Promise.allSettled([controller.stop(), globalDictationHold.stop()]).then((results) => {
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") streamDeck.logger.error(`Codex shutdown failed: ${bridgeFailureCode(failed.reason)}`);
    process.exit(failed ? 1 : 0);
  });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
