using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Accessibility;

// Read-only MSAA client for older PowerBuilder DataWindows. No DLL injection,
// focus changes, keystrokes, database access or writes to the clinical program.
public static class CISAccessibility {
    public class Field {
        public string id = "", name = "", label = "", value = "", node = "", scope = "", provider = "msaa";
        public bool visible = true;
    }
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible result);
    [DllImport("oleacc.dll")]
    static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children, out int obtained);
    [DllImport("oleacc.dll")]
    static extern int WindowFromAccessibleObject(IAccessible accessible, out IntPtr hwnd);
    delegate bool EnumWindow(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hwnd, StringBuilder result, int maximum);
    [DllImport("user32.dll")]
    static extern IntPtr GetParent(IntPtr hwnd);

    static string ClassName(IntPtr hwnd) {
        StringBuilder text = new StringBuilder(256);
        GetClassName(hwnd, text, text.Capacity);
        return text.ToString();
    }
    static bool IsDataWindow(IntPtr hwnd) {
        string name = ClassName(hwnd).ToLowerInvariant();
        return name.StartsWith("pbdw") || name.Contains("datawindow");
    }
    public static string Normalize(string text) {
        if (text == null) return "";
        StringBuilder result = new StringBuilder();
        foreach (char original in text.Normalize(NormalizationForm.FormD)) {
            char c = char.ToLowerInvariant(original);
            if (c == '\u0111') c = 'd';
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) result.Append(c);
        }
        return result.ToString();
    }
    static string Semantic(string text, Dictionary<string, string> aliases) {
        string prefix = text ?? "";
        int colon = prefix.IndexOf(':');
        int fullColon = prefix.IndexOf('\uFF1A');
        if (fullColon >= 0 && (colon < 0 || fullColon < colon)) colon = fullColon;
        if (colon >= 0) prefix = prefix.Substring(0, colon);
        string normalized = Normalize(prefix);
        string alias;
        return aliases.TryGetValue(normalized, out alias) ? alias : null;
    }
    static string Scope(IAccessible accessible, IntPtr root) {
        IntPtr handle;
        if (WindowFromAccessibleObject(accessible, out handle) != 0) return "";
        for (int i = 0; i < 20 && handle != IntPtr.Zero && handle != root; i++, handle = GetParent(handle)) {
            if (IsDataWindow(handle)) return handle.ToInt64().ToString(CultureInfo.InvariantCulture);
        }
        return "";
    }
    static void Visit(IAccessible acc, object childId, string path, int depth, IntPtr root, Dictionary<string, string> aliases, List<Field> result, DateTime deadline, ref int budget) {
        if (acc == null || depth > 24 || budget-- <= 0 || DateTime.UtcNow > deadline) return;
        try {
            int state = Convert.ToInt32(acc.get_accState(childId), CultureInfo.InvariantCulture);
            if ((state & (0x8000 | 0x10000)) != 0) return; // invisible/offscreen
            string name = acc.get_accName(childId) ?? "";
            string label = Semantic(name, aliases);
            if (label == null) label = Semantic(acc.get_accDescription(childId), aliases);
            if (label != null) {
                string value = "";
                try { value = acc.get_accValue(childId) ?? ""; } catch (COMException) { }
                name = name.Replace('\uFF1A', ':');
                if (value.Length == 0 && name.IndexOf(':') >= 0) value = name.Substring(name.IndexOf(':') + 1).Trim();
                if (value.Length == 0 && Semantic(name, aliases) == null) {
                    int role = Convert.ToInt32(acc.get_accRole(childId), CultureInfo.InvariantCulture);
                    if (role == 41 || role == 42) value = name;
                }
                if (value.Length > 0 && value.Length <= 100) result.Add(new Field { name = label, value = value, node = path, scope = Scope(acc, root) });
            }
        } catch (COMException) { }
        catch (InvalidCastException) { }
        if (!(childId is int) || (int)childId != 0) return;
        try {
            int count = Math.Min(acc.accChildCount, 300);
            if (count <= 0) return;
            object[] children = new object[count];
            int obtained;
            if (AccessibleChildren(acc, 0, count, children, out obtained) < 0) return;
            for (int i = 0; i < obtained && budget > 0; i++) {
                IAccessible nested = children[i] as IAccessible;
                if (nested != null) Visit(nested, 0, path + "/" + i, depth + 1, root, aliases, result, deadline, ref budget);
                else if (children[i] is int) Visit(acc, children[i], path + "/c" + children[i], depth + 1, root, aliases, result, deadline, ref budget);
            }
        } catch (COMException) { }
    }
    static void ReadRoot(IntPtr window, IntPtr root, Dictionary<string, string> aliases, List<Field> result, DateTime deadline, ref int budget) {
        Guid iid = typeof(IAccessible).GUID;
        IAccessible accessible;
        if (AccessibleObjectFromWindow(window, unchecked((uint)-4), ref iid, out accessible) == 0) Visit(accessible, 0, window.ToInt64().ToString(), 0, root, aliases, result, deadline, ref budget);
    }
    public static Field[] Read(IntPtr root, string[] aliases) {
        // Normalize configuration once, not once per alias for every UI node.
        Dictionary<string, string> lookup = new Dictionary<string, string>();
        foreach (string alias in aliases) lookup[Normalize(alias)] = alias;
        List<Field> result = new List<Field>();
        DateTime deadline = DateTime.UtcNow.AddSeconds(3);
        int budget = 2500;
        ReadRoot(root, root, lookup, result, deadline, ref budget);
        if (result.Count < 3 && DateTime.UtcNow < deadline) {
            result.Clear();
            List<IntPtr> windows = new List<IntPtr>();
            EnumChildWindows(root, delegate(IntPtr child, IntPtr unused) { if (IsDataWindow(child)) windows.Add(child); return windows.Count < 40; }, IntPtr.Zero);
            foreach (IntPtr child in windows) ReadRoot(child, root, lookup, result, deadline, ref budget);
        }
        return result.ToArray();
    }
}
