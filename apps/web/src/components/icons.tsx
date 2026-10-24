import * as H from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type * as React from "react";

/**
 * The app's icons: Hugeicons (free set), 1.5 stroke, per the family theme. Exported under the
 * names the code used with lucide, so call sites stay the same. Size like lucide: 24 by
 * default, set with a `size-*` class (components size bare svgs themselves).
 */
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "ref"> & { size?: number };
export type LucideIcon = React.ComponentType<IconProps>;

function icon(svg: IconSvgElement, name: string): LucideIcon {
  // biome-ignore lint/correctness/noComponentHookFactories: runs once per icon at module load, never during render
  function Icon({ size = 24, strokeWidth = 1.5, ...props }: IconProps) {
    return (
      <HugeiconsIcon
        icon={svg}
        size={size}
        strokeWidth={Number(strokeWidth)}
        aria-hidden={props["aria-label"] ? undefined : true}
        {...(props as Record<string, unknown>)}
      />
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowDown = icon(H.ArrowDown02Icon, "ArrowDown");
export const ArrowUp = icon(H.ArrowUp02Icon, "ArrowUp");
export const Bell = icon(H.Notification03Icon, "Bell");
export const BellOff = icon(H.NotificationOff01Icon, "BellOff");
export const BellRing = icon(H.Notification01Icon, "BellRing");
export const BookOpen = icon(H.BookOpen01Icon, "BookOpen");
export const CalendarCheck = icon(H.CalendarCheckIn01Icon, "CalendarCheck");
export const CalendarIcon = icon(H.Calendar03Icon, "CalendarIcon");
export const Check = icon(H.Tick02Icon, "Check");
export const CheckIcon = Check;
export const ChevronDown = icon(H.ArrowDown01Icon, "ChevronDown");
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = icon(H.ArrowLeft01Icon, "ChevronLeft");
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = icon(H.ArrowRight01Icon, "ChevronRight");
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = icon(H.ArrowUp01Icon, "ChevronUp");
export const ChevronUpIcon = ChevronUp;
export const ChevronsLeft = icon(H.ArrowLeftDoubleIcon, "ChevronsLeft");
export const ChevronsRight = icon(H.ArrowRightDoubleIcon, "ChevronsRight");
export const ChevronsUpDown = icon(H.UnfoldMoreIcon, "ChevronsUpDown");
export const CircleAlert = icon(H.AlertCircleIcon, "CircleAlert");
export const CircleCheck = icon(H.CheckmarkCircle02Icon, "CircleCheck");
export const CircleCheckIcon = CircleCheck;
export const CircleDashed = icon(H.DashedLineCircleIcon, "CircleDashed");
export const CircleX = icon(H.CancelCircleIcon, "CircleX");
export const XCircle = CircleX;
export const OctagonXIcon = CircleX;
export const Clapperboard = icon(H.Video01Icon, "Clapperboard");
export const ClipboardCheck = icon(H.TaskDone01Icon, "ClipboardCheck");
export const ClipboardList = icon(H.Task01Icon, "ClipboardList");
export const Copy = icon(H.Copy01Icon, "Copy");
export const Download = icon(H.Download01Icon, "Download");
export const ExternalLink = icon(H.LinkSquare02Icon, "ExternalLink");
export const Eye = icon(H.ViewIcon, "Eye");
export const EyeOff = icon(H.ViewOffSlashIcon, "EyeOff");
export const FileCheck2 = icon(H.FileValidationIcon, "FileCheck2");
export const FileCode2 = icon(H.FileScriptIcon, "FileCode2");
export const FileMinus2 = icon(H.FileRemoveIcon, "FileMinus2");
export const FileQuestion = icon(H.FileUnknownIcon, "FileQuestion");
export const FileText = icon(H.File01Icon, "FileText");
export const FileUp = icon(H.FileUploadIcon, "FileUp");
export const FolderOpen = icon(H.Folder02Icon, "FolderOpen");
export const Globe = icon(H.GlobeIcon, "Globe");
export const GraduationCap = icon(H.Mortarboard01Icon, "GraduationCap");
export const InfoIcon = icon(H.InformationCircleIcon, "InfoIcon");
export const KeyRound = icon(H.Key01Icon, "KeyRound");
export const Layers = icon(H.Layers01Icon, "Layers");
export const ListChecks = icon(H.CheckListIcon, "ListChecks");
export const LoaderCircle = icon(H.Loading03Icon, "LoaderCircle");
export const Loader2Icon = LoaderCircle;
export const LogOut = icon(H.Logout03Icon, "LogOut");
export const Mail = icon(H.Mail01Icon, "Mail");
export const MailCheck = icon(H.MailValidation01Icon, "MailCheck");
export const MapPinOff = icon(H.LocationOffline01Icon, "MapPinOff");
export const MessageCircleQuestion = icon(H.BubbleChatQuestionIcon, "MessageCircleQuestion");
export const MessagesSquare = icon(H.BubbleChatIcon, "MessagesSquare");
export const Monitor = icon(H.ComputerIcon, "Monitor");
export const Moon = icon(H.Moon02Icon, "Moon");
export const MoreHorizontalIcon = icon(H.MoreHorizontalIcon, "MoreHorizontalIcon");
export const NotebookPen = icon(H.NoteEditIcon, "NotebookPen");
export const NotebookText = icon(H.Note01Icon, "NotebookText");
export const PanelLeftIcon = icon(H.SidebarLeftIcon, "PanelLeftIcon");
export const PartyPopper = icon(H.PartyIcon, "PartyPopper");
export const Pencil = icon(H.PencilEdit02Icon, "Pencil");
export const PencilRuler = icon(H.PencilEdit01Icon, "PencilRuler");
export const Plus = icon(H.PlusSignIcon, "Plus");
export const PlusCircle = icon(H.PlusSignCircleIcon, "PlusCircle");
export const RefreshCw = icon(H.RefreshIcon, "RefreshCw");
export const RotateCcw = icon(H.ReloadIcon, "RotateCcw");
export const ScanText = icon(H.TextIcon, "ScanText");
export const Search = icon(H.Search01Icon, "Search");
export const SearchIcon = Search;
export const SearchX = icon(H.SearchRemoveIcon, "SearchX");
export const Send = icon(H.SentIcon, "Send");
export const Settings = icon(H.Settings02Icon, "Settings");
export const Settings2 = icon(H.SlidersHorizontalIcon, "Settings2");
export const Smartphone = icon(H.SmartPhone01Icon, "Smartphone");
export const Sparkles = icon(H.SparklesIcon, "Sparkles");
export const Square = icon(H.SquareIcon, "Square");
export const Sun = icon(H.Sun03Icon, "Sun");
export const Trash2 = icon(H.Delete02Icon, "Trash2");
export const TriangleAlertIcon = icon(H.Alert02Icon, "TriangleAlertIcon");
export const Upload = icon(H.Upload04Icon, "Upload");
export const Wrench = icon(H.Wrench01Icon, "Wrench");
export const X = icon(H.Cancel01Icon, "X");
export const XIcon = X;
