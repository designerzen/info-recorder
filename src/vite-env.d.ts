/// <reference types="vite/client" />

import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      selectedcontent: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
