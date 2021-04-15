import Frames from "./Frames";
import ShapeView from "./ShapeView";
import Mod from "./Mod";
import Errors from "inspector/views/Errors";
import Opt from "./Opt";
import CompGraph from "./CompGraph";
import Settings from "./Settings";
const viewMap = {
  frames: Frames,
  errors: Errors,
  // logs: LogView,
  shapes: ShapeView,
  mod: Mod,
  opt: Opt,
  compGraph: CompGraph,
  settings: Settings
};
export default viewMap;