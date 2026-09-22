// Order matters: the `@use "/devtools-ui"` loader must be installed before
// `<quark-sheet>` is defined (sheets fetch imports the moment they upgrade).
import "../../lib/quark-modules";
import "./element.css";
import "@excom/nucleus-kit";
import { defineDevtoolsSelection } from "../../lib/devtools-selection";

defineDevtoolsSelection();
