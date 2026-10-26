/** JSX is compiled directly to native nodes; there is no virtual DOM. */
export type DomContent = Node | string | number | boolean | null | undefined | DomContent[];
export type CSSProperties = Record<string, string | number | undefined>;
export type DomEvent<T extends Event = Event, E extends Element = HTMLElement> = T & {
    target: E;
    currentTarget: E;
};
type Props = Record<string, any>;
type ManagedNode = Node & {
    domProps?: Props;
    domKey?: string | number;
};
const svgTags = new Set(["svg", "path", "circle", "line", "polyline", "polygon", "rect", "ellipse", "g"]);
export function Fragment(props: {
    children?: DomContent;
}) { return fragment(props.children); }
export function h(tag: string | ((props: any) => DomContent), props: Props | null, ...children: DomContent[]): any {
    const attributes: Props = { ...props, children: children.length ? children : props?.children };
    if (typeof tag === "function")
        return tag(attributes);
    const node = (svgTags.has(tag) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag)) as Element & ManagedNode;
    node.domProps = attributes;
    node.domKey = attributes.key;
    append(node, attributes.children);
    applyProps(node, {}, attributes);
    return node;
}
function append(parent: Node, content: DomContent) {
    if (Array.isArray(content)) {
        for (const child of content)
            append(parent, child);
    }
    else if (content instanceof Node)
        parent.appendChild(content);
    else if (content !== null && content !== undefined && typeof content !== "boolean")
        parent.appendChild(document.createTextNode(String(content)));
}
function fragment(content: DomContent) { const node = document.createDocumentFragment(); append(node, content); return node; }
function eventName(name: string, element: Element) {
    if (name === "onDoubleClick")
        return "dblclick";
    if (name === "onChange" && element instanceof HTMLInputElement)
        return element.type === "checkbox" || element.type === "radio" ? "click" : "input";
    return name.slice(2).toLowerCase();
}
function applyProps(element: Element, previous: Props, next: Props) {
    for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        const value = next[name];
        if (name === "children" || name === "key" || name === "ref" || name.startsWith("__"))
            continue;
        if (name.startsWith("on")) {
            const type = eventName(name, element);
            if (previous[name])
                element.removeEventListener(type, previous[name]);
            if (value)
                element.addEventListener(type, value);
            // A programmatic change event is useful for accessibility tools and tests.
            if (type === "input" && name === "onChange") {
                if (previous[name])
                    element.removeEventListener("change", previous[name]);
                if (value)
                    element.addEventListener("change", value);
            }
        }
        else if (name === "style") {
            const style = (element as HTMLElement).style;
            style.cssText = "";
            for (const [key, entry] of Object.entries(value ?? {})) {
                style.setProperty(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), String(entry));
            }
        }
        else {
            const attribute = name === "className" ? "class" : name === "htmlFor" ? "for" : name === "tabIndex" ? "tabindex" : name;
            const boolean = ["disabled", "checked", "multiple", "hidden", "inert", "open", "autoFocus", "controls", "muted", "loop", "required", "readOnly", "selected"].includes(name);
            if (value === undefined || value === null || (boolean && !value))
                element.removeAttribute(attribute);
            else
                element.setAttribute(attribute, boolean ? "" : String(value));
            if ((name === "value" || name === "checked") && name in element && (element as any)[name] !== value && value !== undefined)
                (element as any)[name] = value;
        }
    }
}
function bindRefs(node: Node) {
    const ref = (node as ManagedNode).domProps?.ref;
    if (typeof ref === "function")
        ref(node);
    else if (ref)
        ref.current = node;
    for (const child of node.childNodes)
        bindRefs(child);
}
function releaseRefs(node: Node) {
    const ref = (node as ManagedNode).domProps?.ref;
    if (typeof ref === "function")
        ref(null);
    else if (ref && ref.current === node)
        ref.current = null;
    for (const child of node.childNodes)
        releaseRefs(child);
}
function compatible(left: ManagedNode, right: ManagedNode) {
    return left.nodeType === right.nodeType && left.nodeName === right.nodeName && left.domKey === right.domKey;
}
/** Keep live media/canvas nodes, focus, selection and scroll position during updates. */
export function patch(parent: Node, content: DomContent) {
    const desired = fragment(content);
    const inserted: Node[] = [];
    let current = parent.firstChild as ManagedNode | null;
    for (const next of Array.from(desired.childNodes) as ManagedNode[]) {
        if (current === next) {
            current = current.nextSibling as ManagedNode | null;
            continue;
        }
        if (!current || !compatible(current, next)) {
            const match = (current ? Array.from(parent.childNodes).slice(Array.from(parent.childNodes).indexOf(current as ChildNode) + 1) : [])
                .find((node) => compatible(node as ManagedNode, next)) as ManagedNode | undefined;
            if (match) {
                if ("moveBefore" in parent && parent.isConnected && match.isConnected)
                    (parent as Element).moveBefore(match, current);
                else
                    parent.insertBefore(match, current);
                current = match;
            }
            else {
                parent.insertBefore(next, current);
                inserted.push(next);
                continue;
            }
        }
        if (current.nodeType === Node.TEXT_NODE) {
            if (current.textContent !== next.textContent)
                current.textContent = next.textContent;
        }
        else if (current instanceof Element && next instanceof Element) {
            if (current instanceof ViewElement && next instanceof ViewElement)
                current.setProps(next.props);
            else {
                patch(current, Array.from(next.childNodes));
                const previousRef = (current as ManagedNode).domProps?.ref;
                applyProps(current, (current as ManagedNode).domProps ?? {}, (next as ManagedNode).domProps ?? {});
                (current as ManagedNode).domProps = (next as ManagedNode).domProps;
                const ref = (current as ManagedNode).domProps?.ref;
                if (typeof ref === "function") {
                    if (ref !== previousRef)
                        ref(current);
                }
                else if (ref)
                    ref.current = current;
            }
        }
        current = current.nextSibling as ManagedNode | null;
    }
    while (current) {
        const next = current.nextSibling as ManagedNode | null;
        releaseRefs(current);
        parent.removeChild(current);
        current = next;
    }
    for (const node of inserted)
        bindRefs(node);
}
type ElementController<P> = {
    update(props: P): void;
    dispose(): void;
};
class ViewElement extends HTMLElement {
    props: any;
    controller?: ElementController<any>;
    factory!: (props: any, host: HTMLElement) => ElementController<any>;
    setProps(props: any) { this.props = props; this.controller?.update(props); }
    connectedCallback() { this.style.display = "contents"; if (!this.controller)
        this.controller = this.factory(this.props, this); }
    connectedMoveCallback() { }
    disconnectedCallback() { if (!this.isConnected) {
        this.controller?.dispose();
        this.controller = undefined;
    } }
}
/** Native custom-element lifecycle owns each view's machine and browser subscriptions. */
export function defineElement<P>(name: string, factory: (props: P, host: HTMLElement) => ElementController<P>) {
    if (!customElements.get(name))
        customElements.define(name, class extends ViewElement {
            factory = factory;
        });
    return (props: P) => { const element = document.createElement(name) as ViewElement; element.setProps(props); return element; };
}
declare global {
    namespace JSX {
        type Element = DomContent;
        interface ElementChildrenAttribute {
            children: {};
        }
        interface IntrinsicAttributes {
            key?: string | number;
        }
        interface IntrinsicElements {
            [tag: string]: Props & {
                onClick?: (event: DomEvent<MouseEvent, any>) => void;
                onChange?: (event: DomEvent<Event, any>) => void;
                onKeyDown?: (event: DomEvent<KeyboardEvent, any>) => void;
                onPointerDown?: (event: DomEvent<PointerEvent, any>) => void;
                onPointerMove?: (event: DomEvent<PointerEvent, any>) => void;
                onPointerUp?: (event: DomEvent<PointerEvent, any>) => void;
                onDragOver?: (event: DomEvent<DragEvent, any>) => void;
                onDrop?: (event: DomEvent<DragEvent, any>) => void;
                onCancel?: (event: Event) => void;
            };
        }
    }
}
