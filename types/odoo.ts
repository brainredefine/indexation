// types/odoo.ts
export type M2O = [number, string] | false | null | undefined;

export type TenancyRaw = {
  id: number;
  uuid?: string;
  name?: string;
  main_property_id?: M2O;
  indexing_rent?: number;
  index_id?: M2O;
  lock_date?: string | false | null;
  adjustment_period?: string | number | null;
  adjustment_date?: string | false | null;
  threshold?: number | null;
  partially_passing_on?: boolean | null;
  maximal_percentage?: number | null;
  waiting_time?: number | null;
};

export type TenancyWithSales = {
  id: number;
  uuid?: string;
  name?: string;
  main_property_id?: M2O;
  sales_person_id?: M2O;        // récupéré via property.property
  indexing_rent?: number;
  index_id?: M2O;
  index_name?: string | null;   // index_id[1] pratique
  lock_date?: string | null;
  adjustment_period?: string | number | null;
  adjustment_date?: string | null;
  threshold?: number | null;
  partially_passing_on?: boolean | null;
  maximal_percentage?: number | null;
  waiting_time?: number | null;
};
